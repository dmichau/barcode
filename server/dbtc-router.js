
const assert = require('assert');

const express = require('express');
const multer = require('multer');

const {
    findUsersWithPrefix,
    lookupUser,
    getThreadsForItemType,
    getDBTCThreadsForUser,
    getThreadPosts,
    validateUserThread
} = require('./xenforo');

const {
    itemAdded,
    itemImported,
    madeFragsAvailable,
    fragGiven,
    fragTransferred,
    journalUpdated,
    fragDied
} = require('./forum');

const {saveImageFromUrl, isGoodId} = require('./utility');

//-----------------------------------------------------------------------------
// Config
//-----------------------------------------------------------------------------

const {BC_UPLOADS_DIR, BC_SITE_BASE_URL} = require('./barcode.config');

//-----------------------------------------------------------------------------
// The database
//-----------------------------------------------------------------------------

const db = require('./dbtc-database');

//-----------------------------------------------------------------------------
// Errors
//-----------------------------------------------------------------------------

const {
    INVALID_FRAG,
    INVALID_INCREMENT,
    INVALID_RECIPIENT,
    INVALID_RULES,
    NOT_YOURS,
    INVALID_IMPORT
} = require('./errors');

//-----------------------------------------------------------------------------
// The destinaton for uploaded files (pictures)
//-----------------------------------------------------------------------------

const upload = multer({dest: BC_UPLOADS_DIR});

//-----------------------------------------------------------------------------
// The router
//-----------------------------------------------------------------------------

const router = express.Router();

//-----------------------------------------------------------------------------
// My collection of frags
//-----------------------------------------------------------------------------

router.get('/your-collection', (req, res) => {
    const {user} = req;
    const frags = db.selectAllFragsForUser(user);
    frags.forEach((frag) => {
        frag.owner = user;
        frag.ownsIt = true;
    });
    res.json({
        user,
        frags
    });
});

//-----------------------------------------------------------------------------
// Data about one frag
//-----------------------------------------------------------------------------

router.get('/frag/:fragId', async (req, res, next) => {
    const {user, params} = req;
    const {fragId} = params;
    const [frag, journals] = db.selectFrag(fragId);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // If the frag is private and the caller is not the owner,
    // we don't expose it
    if (frag.rules === 'private' && user.id !== frag.ownerId) {
        return next(INVALID_FRAG());
    }
    frag.owner = await lookupUser(frag.ownerId, true);
    frag.ownsIt = frag.ownerId === user.id;
    frag.isFan = db.isFan(user.id, frag.motherId);
    res.json({
        user,
        frag,
        journals
    });
});

//-----------------------------------------------------------------------------
// Create a shareable link to a frag
//-----------------------------------------------------------------------------

router.get('/share/:fragId', async (req, res, next) => {
    const {user, params: {fragId}} = req;
    const [frag, journals] = db.selectFrag(fragId);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // Only the owner can share it
    if (frag.ownerId !== user.id) {
        return next(NOT_YOURS());
    }
    frag.owner = await lookupUser(frag.ownerId, true);
    // We set it to false, so it will always be false in the
    // data we save
    frag.ownsIt = false;
    frag.isStatic = true;
    const shareId = db.shareFrag(frag, journals);
    const url = `${BC_SITE_BASE_URL}/shared/${shareId}`;
    res.json({url});
});

//-----------------------------------------------------------------------------
// Get journals for a frag
//-----------------------------------------------------------------------------

router.get('/journals/:fragId', (req, res, next) => {
    const {user, params} = req;
    const {fragId} = params;
    const [frag, journals] = db.selectFrag(fragId);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // If the frag is private and the caller is not the owner,
    // we don't expose it
    if (frag.rules === 'private' && user.id !== frag.ownerId) {
        return next(INVALID_FRAG());
    }
    res.json({
        journals
    });
});

//-----------------------------------------------------------------------------
// When a new item is added
//-----------------------------------------------------------------------------

router.post('/add-new-item', upload.single('picture'), (req, res) => {
    // 'file' is added by multer and has all the information about the
    // uploaded file if one was present
    const {user, body, file} = req;
    const picture = file ? file.filename : null;
    // Inputs from the form
    const params = {
        ...body,
        ownerId: user.id,
        fragsAvailable: parseInt(body.fragsAvailable, 10),
        cost: parseFloat(body.cost),
        picture,
        threadId: parseInt(body.threadId, 10)
    };
    // Add the new item
    const [, fragId] = db.insertItem(params);
    // Add a journal
    const journal = db.addJournal({
        fragId,
        timestamp: body.dateAcquired,
        entryType: 'acquired',
        picture,
        notes: body.source ?
            `Got it from ${body.source}` : 'Acquired it'
    });
    // Post to the forum out of band
    itemAdded(fragId);
    // Reply
    res.json({fragId, journal});
});

//-----------------------------------------------------------------------------
// Update a frag and, optionally, its mother
//-----------------------------------------------------------------------------

// Function to de-camelize, taken from
// https://ourcodeworld.com/articles/read/608/how-to-camelize-and-decamelize-strings-in-javascript

function decamelize(str){
	return str
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1 $2')
        .toLowerCase();
}

router.post('/update/:fragId', upload.none(), (req, res, next) => {
    const {user, body, params: {fragId}} = req;
    // Make sure this frag exists, is alive and belongs to this user
    const frag = db.validateFrag(user.id, fragId, true, -1);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // If the frag is a mother frag, we can update the mother
    if (!frag.fragOf) {
        db.updateMother({
            ...body,
            cost: parseFloat(body.cost),
            motherId: frag.motherId
        });
    }
    // Update the frag itself
    db.updateFrag({
        ...body,
        fragId
    });
    // Get the frag's updated values so we can compare
    const updatedFrag = db.validateFrag(user.id, fragId, true, -1);
    // Build a string of the names of fields that changed, excluding
    // the timestamp
    const changed = Object.keys(frag)
        .filter((key) => frag[key] !== updatedFrag[key] && key != 'timestamp')
        .map((key) => decamelize(key))
        .join(', ');
    // If something changed, add a journal
    if (changed) {
        // Add a journal entry
        db.addJournal({
            fragId,
            entryType: 'changed',
            notes: 'Changed ' + changed
        });
    }
    res.json({});
});

//-----------------------------------------------------------------------------
// Changing the number of available frags
//-----------------------------------------------------------------------------

router.put('/frag/:fragId/available/:fragsAvailable', (req, res, next) => {
    const {user, params} = req;
    const {fragId, fragsAvailable} = params;
    // Validate the frag. It must belong to this user and be alive. We don't
    // care how many frags are already available, so we send -1 for that
    const frag = db.validateFrag(user.id, fragId, true, -1);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // If the frag is private, you cannot make frags available
    if (frag.rules === 'private') {
        return next(INVALID_FRAG());
    }
    // Validate fragsAvailable
    const value = parseInt(fragsAvailable, 10);
    if (isNaN(value) || value < 0) {
        return next(INVALID_INCREMENT());
    }
    // Now update it, which returns the new value
    const result = db.updateFragsAvailable(user.id, fragId, value);
    // Add a journal
    const journal = db.addJournal({
        fragId,
        timestamp: null,
        entryType: 'fragged',
        picture: null,
        notes: `Updated available frags to ${value}`
    });
    // Post to the forum
    if (result) {
        madeFragsAvailable(user, {
            ...frag,
            fragsAvailable: result
        });
    }
    // Reply
    res.json({
        fragsAvailable: result,
        journal
    });
});

//-----------------------------------------------------------------------------
// Giving a frag
//-----------------------------------------------------------------------------

router.post('/give-a-frag', upload.single('picture'), async (req, res, next) => {
    // 'file' is added by multer and has all the information about the
    // uploaded file if one was present
    const {user, body, file} = req;
    const picture = file ? file.filename : null;
    // Validate
    const {fragOf, ownerId, dateAcquired, transfer} = body;
    // Validate the frag. It must belong to this user and be alive.
    const frag = db.validateFrag(user.id, fragOf, true, -1);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // If the frag is private, you cannot give a frag
    if (frag.rules === 'private') {
        return next(INVALID_FRAG());
    }
    // Now make sure the new owner is allowed
    const recipient = await lookupUser(ownerId);
    if (!(recipient && recipient.allowed)) {
        return next(INVALID_RECIPIENT());
    }
    // You can't give a frag to yourself
    if (recipient.id === user.id) {
        return next(INVALID_RECIPIENT());
    }
    // Inputs from the form
    const params = {
        ...body,
        picture
    };
    // Do it
    const [fragsAvailable, newFragId] = db.giveAFrag(user.id, params);
    // Add a journal entry for the recipient
    db.addJournal({
        fragId: newFragId,
        timestamp: dateAcquired,
        entryType: 'acquired',
        notes: transfer ?
            `Transferred from ${user.name}` :
            `Got it from ${user.name}`
    });

    // Add a journal entry for the one who gave it
    const journal = db.addJournal({
        fragId: fragOf,
        timestamp: dateAcquired,
        entryType: 'gave',
        picture,
        notes: transfer ?
            `Transferred to ${recipient.name}` :
            `Gave a frag to ${recipient.name}`
    });
    // Remove the recipient from the fans table
    db.removeFan(recipient.id, frag.motherId);
    // Post to the forum
    if (transfer) {
        fragTransferred(user, recipient, newFragId);
    }
    else {
        fragGiven(user, recipient, newFragId);
    }
    // Reply
    res.json({
        fragsAvailable,
        journal
    });
});

//-----------------------------------------------------------------------------
// Add a journal entry
//-----------------------------------------------------------------------------

router.post('/frag/:fragId/journal', upload.single('picture'), (req, res, next) => {
    // 'file' is added by multer and has all the information about the
    // uploaded file if one was present
    const {user, body, params, file} = req;
    const picture = file ? file.filename : null;
    // Validate
    const {fragId} = params;
    // Validate the frag. It must belong to this user and be alive. It must
    // have > -1 frags available
    const frag = db.validateFrag(user.id, fragId, true, -1);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // Do it
    const journal = db.addJournal({
        fragId,
        timestamp: null,
        entryType: body.entryType || null,
        picture,
        notes: body.notes || null
    });
    // Update the cover picture for the frag
    let coverPicture;
    if (body.makeCoverPicture && picture) {
        db.updateFragPicture(user.id, fragId, picture);
        coverPicture = picture;
    }
    // Post to the forum
    journalUpdated(user, frag, journal);
    // Reply
    res.json({
        journal,
        coverPicture
    });
});

//-----------------------------------------------------------------------------
// Mark a frag as dead
//-----------------------------------------------------------------------------

router.post('/frag/:fragId/rip', upload.none(), (req, res, next) => {
    // 'file' is added by multer and has all the information about the
    // uploaded file if one was present
    const {user, body, params} = req;
    // Validate
    const {fragId} = params;
    // Validate the frag. It must belong to this user and be alive. It must
    // have > -1 frags available
    const frag = db.validateFrag(user.id, fragId, true, -1);
    if (!frag) {
        return next(INVALID_FRAG());
    }
    // Do it
    db.markAsDead(user.id, fragId);
    // Add a journal
    const journal = db.addJournal({
        fragId,
        timestamp: null,
        entryType: 'rip',
        picture: null,
        notes: body.notes || 'RIP'
    });
    // Post to the thread
    fragDied(user, frag, journal);
    // Reply
    res.json({journal});
});

//-----------------------------------------------------------------------------
// Returns a collection of mothers for the given rules
//-----------------------------------------------------------------------------

router.get('/collection/:rules/p/:page', async (req, res, next) => {
    const {user, params: {rules, page}, query} = req;
    if (!db.validateRules(rules)) {
        return next(INVALID_RULES());
    }
    if (rules === 'private') {
        return next(INVALID_RULES());
    }
    const mothers = db.selectCollectionPaged(user.id, rules, page, query);
    await Promise.all(mothers.map(async (mother) => {
        mother.owner = await lookupUser(mother.ownerId, true);
        mother.inCollection = true;
    }));
    res.json({
        user,
        mothers
    });
});

//-----------------------------------------------------------------------------
// Returns all frags for a given mother
//-----------------------------------------------------------------------------

router.get('/kids/:motherId', async (req, res, next) => {
    const {user, params: {motherId}} = req;
    const frags = db.selectFragsForMother(motherId);
    const isPrivate = frags.some(({rules}) => rules === 'private');
    if (isPrivate) {
        return next(NOT_YOURS());
    }
    // Now, get full user information about all of the
    // owners. This could get expensive
    await Promise.all(frags.map(async (frag) => {
        frag.owner = await lookupUser(frag.ownerId, true);
        frag.ownsIt = frag.ownerId === user.id;
    }));
    res.json({
        user,
        frags
    });
});

//-----------------------------------------------------------------------------
// Get a lineage tree for a mother
//-----------------------------------------------------------------------------

router.get('/tree/:motherId', async (req, res, next) => {
    const {user, params: {motherId}} = req;
    const frags = db.selectFragsForMother(motherId);
    if (frags.length === 0) {
        return next(INVALID_FRAG());
    }
    if (frags.some((frag) => frag.rules === 'private' && frag.ownerId !== user.id)) {
        return next(NOT_YOURS());
    }
    const map = new Map(frags.map((frag) => [frag.fragId, frag]));
    await Promise.all(frags.map(async (frag) => {
        frag.owner = await lookupUser(frag.ownerId, true);
    }));
    const [root] = frags.filter((frag) => {
        if (frag.fragOf) {
            const parent = map.get(frag.fragOf);
            if (parent.children) {
                parent.children.push(frag);
            }
            else {
                parent.children = [frag];
            }
            return false;
        }
        return true;
    });
    if (!root.children) {
        root.children = [];
    }
    res.json({root});
});

//-----------------------------------------------------------------------------
// Become a fan or stop being a fan

router.put('/fan/:motherId', (req, res) => {
    const {user, params: {motherId}} = req;
    db.addFan(user.id, motherId);
    res.json(db.getLikes(user.id, motherId));
});

router.delete('/fan/:motherId', (req, res) => {
    const {user, params: {motherId}} = req;
    db.removeFan(user.id, motherId);
    res.json(db.getLikes(user.id, motherId));
});

router.get('/fan/:motherId', (req, res) => {
    const {user, params: {motherId}} = req;
    res.json(db.getLikes(user.id, motherId));
});

//-----------------------------------------------------------------------------
// Get enums (types and rules for now)
//-----------------------------------------------------------------------------

router.get('/enums', (req, res) => {
    res.json(db.getEnums());
});

//-----------------------------------------------------------------------------
// Get threads for a specific type
//-----------------------------------------------------------------------------

router.get('/threads-for-type', async (req, res) => {
    const {user, query} = req;
    const {type} = query;
    const threads = await getThreadsForItemType(user.id, type);
    res.json({
        threads
    });
});

//-----------------------------------------------------------------------------
// Gets a page of DBTC threads for the current user excluding those that have
// already been imported
//-----------------------------------------------------------------------------

router.get('/imports', async (req, res) => {
    const {user} = req;
    // This is a set of all threads that this user has created or imported
    const imported = new Set(db.getUserThreadIds(user.id));
    // These are the threads loaded from the forum
    const allThreads = await getDBTCThreadsForUser(user.id);
    // Remove those that are already here
    const threads = allThreads.filter(({threadId}) => !imported.has(threadId));
    res.json({user, threads});
});

router.get('/imports/:threadId', async (req, res, next) => {
    const {user, params: {threadId}} = req;
    const posts = await getThreadPosts(user.id, threadId);
    if (!posts) {
        return next(NOT_YOURS());
    }
    res.json({posts});
});

router.post('/import', upload.single('picture'), async (req, res, next) => {
    const {user, body, file} = req;
    let picture = file ? file.filename : null;
    const {
        threadId,
        name,
        type,
        dateAcquired,
        pictureUrl,
        transactions: jsonTransactions
    } = body;
    // Validate that the threadId belongs to this user to prevent
    // direct API attacks
    const thread = await validateUserThread(user.id, threadId);
    if (!thread) {
        return next(NOT_YOURS());
    }
    // Parse the transactions
    const transactions = JSON.parse(jsonTransactions);
    // Validate the transactions now, before we insert the mother frag
    const good = transactions.every(({date, from, fromId, type, to, toId}) => {
        try {
            assert(date, 'Missing date');
            assert(from && isGoodId(fromId), 'Missing from information');
            switch (type) {
                case 'gave':
                case 'trans':
                    assert(to && isGoodId(toId),'Missing to information');
                    break;
                case 'rip':
                    break;
                default:
                    assert(false, 'Invalid type');
            }
            return true;
        }
        catch (error) {
            console.error('Import transaction invalid :', error, {
                threadId, date, from, fromId, type, to, toId
            });
            console.error(JSON.stringify(body, null, 2));
        }
    });
    if (!good) {
        return next(INVALID_IMPORT());
    }
    // Now, see if there is a picture URL and download it,
    if (!picture && pictureUrl) {
        try {
            picture = await saveImageFromUrl(upload, pictureUrl);
        }
        catch (error) {
            console.error('Failed to download image', pictureUrl, error);
        }
    }
    // Insert the main frag
    const [motherId, fragId] = db.insertItem({
        name,
        type,
        flow: 'Medium',
        light: 'Medium',
        hardiness: 'Normal',
        growthRate: 'Normal',
        cost: 0,
        rules: 'dbtc',
        threadId,
        threadUrl: thread.viewUrl,
        ownerId: user.id,
        dateAcquired,
        picture,
        fragOf: null,
        fragsAvailable: 0
    });
    // Add a journal entry when it was acquired
    db.addJournal({
        fragId,
        timestamp: dateAcquired,
        entryType: 'acquired',
        notes: 'Acquired it (imported)'
    });
    // Add another journal entry about it being imported
    db.addJournal({
        fragId,
        entryType: 'imported',
        notes: `Imported from the forum`
    });
    // This is a map from user ID to frag ID so that we know who
    // has what as we process each transaction. It starts out with
    // the first frag we just inserted for the current user.
    const fragMap = new Map([[user.id, fragId]]);
    transactions.forEach(({date, from, fromId, type, to, toId}) => {
        function problem(message) {
            console.error('Import transaction failed :', message, {
                threadId, date, from, fromId, type, to, toId
            });
        }
        switch (type) {
            case 'gave': {
                    // Get the source frag ID and bail if it cannot be found
                    const fromFragId = fragMap.get(fromId);
                    if (!fromFragId) {
                        return problem('Could not find the source frag');
                    }
                    const [, toFragId] = db.giveAFrag(fromId, {
                        motherId,
                        ownerId: toId,
                        dateAcquired: date,
                        fragOf: fromFragId,
                        fragsAvailable: 0
                    });
                    // Add thew new frag to our map
                    fragMap.set(toId, toFragId);
                    // Add a journal for the recipient
                    db.addJournal({
                        fragId: toFragId,
                        timestamp: date,
                        entryType: 'acquired',
                        notes: `Got it from ${from} (imported)`
                    });
                    // Now, add a journal for the giver
                    db.addJournal({
                        fragId: fromFragId,
                        timestamp: date,
                        entryType: 'gave',
                        notes: `Gave a frag to ${to} (imported)`
                    });
                }
                break;
            case 'trans': {
                    // Get the source frag ID and bail if it cannot be found
                    const fromFragId = fragMap.get(fromId);
                    if (!fromFragId) {
                        return problem('Could not find the source frag');
                    }
                    const [, toFragId] = db.giveAFrag(fromId, {
                        motherId,
                        ownerId: toId,
                        dateAcquired: date,
                        fragOf: fromFragId,
                        fragsAvailable: 0
                    });
                    // Add thew new frag to our map
                    fragMap.set(toId, toFragId);
                    // Remove the original frag from the map, since this is
                    // a transfer
                    fragMap.delete(fromId);
                    // Add a journal for the recipient
                    db.addJournal({
                        fragId: toFragId,
                        timestamp: date,
                        entryType: 'acquired',
                        notes: `Transferred from ${from} (imported)`
                    });
                    // Now, add a journal for the giver
                    db.addJournal({
                        fragId: fromFragId,
                        timestamp: date,
                        entryType: 'gave',
                        notes: `Transferred to ${to} (imported)`
                    });
                    // Mark the original frag as dead with a transferred status
                    db.markAsDead(fromId, fromFragId, 'transferred');
                }
                break;
            case 'rip': {
                    // Get the source frag ID and bail if it cannot be found
                    const fromFragId = fragMap.get(fromId);
                    if (!fromFragId) {
                        return problem('Could not find the source frag');
                    }
                    // Remove it from the map
                    fragMap.delete(fromId);
                    // Mark it as dead
                    db.markAsDead(fromId, fromFragId);
                    // Add a journal
                    db.addJournal({
                        fragId: fromFragId,
                        timestamp: date,
                        entryType: 'rip',
                        notes: 'RIP (imported)'
                    });
                }
                break;
        }
    });
    // Add a post to the thread out of band
    itemImported(user, threadId, motherId, fragId);
    // Send back the response now
    res.json({motherId, fragId});
});

//-----------------------------------------------------------------------------
// DBTC top 10 lists
//-----------------------------------------------------------------------------

router.get('/top10', async (req, res) => {
    const result = db.getDbtcTop10s();
    await Promise.all(Object.keys(result).map(async (key) => {
        await Promise.all(result[key].map(async (row) => {
            if (row.ownerId) {
                const user = await lookupUser(row.ownerId, true);
                row.ownerName = user ? user.name : '<unknown>';
            }
        }));
    }));
    res.json({...result});
});

//-----------------------------------------------------------------------------
// TODO: Belongs in a '/user' API
//-----------------------------------------------------------------------------

router.get('/find-users', async (req, res) => {
    const {query} = req;
    const {prefix} = query;
    const all = query.all === 'true';
    const fullUsers = await findUsersWithPrefix(prefix, all);
    // Make it smaller, only returning [[id, name],...]
    const users = fullUsers.map(({id, name}) => [id, name]);
    res.json({
        users
    });
});

//-----------------------------------------------------------------------------

module.exports = router;
