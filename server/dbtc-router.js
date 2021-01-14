const express = require('express');
const multer = require('multer');

const {findUsersWithPrefix, lookupUser} = require('./xenforo');

//-----------------------------------------------------------------------------
// Function to get runtime configuration from the environment
//-----------------------------------------------------------------------------

const BarcodeConfig = require('../barcode.config');

//-----------------------------------------------------------------------------
// The database
//-----------------------------------------------------------------------------

const db = require('./dbtc-database');

//-----------------------------------------------------------------------------
// The destinaton for uploaded files (pictures)
//-----------------------------------------------------------------------------

const upload = multer({dest: BarcodeConfig.BC_UPLOADS_DIR});

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
    res.json({
        success: true,
        user,
        frags
    });
});

//-----------------------------------------------------------------------------
// Data about one frag
//-----------------------------------------------------------------------------

router.get('/frag/:fragId', (req, res) => {
    const {user, params} = req;
    const {fragId} = params;
    const [frag, journals] = db.selectFrag(fragId);
    res.json({
        success: true,
        user,
        isOwner: user.id === frag.ownerId,
        frag,
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
        picture
    };
    // Add the new item
    const fragId = db.insertItem(params);
    console.log('Added frag', fragId);
    res.json({
        success: true,
        fragId
    });
});

//-----------------------------------------------------------------------------
// Changing the number of available frags
//-----------------------------------------------------------------------------

router.put('/frag/:fragId/available/:fragsAvailable', (req, res) => {
    const {user, params} = req;
    const {fragId, fragsAvailable} = params;
    // Validate the frag. It must belong to this user and be alive. We don't
    // care how many frags are already available, so we send -1 for that
    const frag = db.validateFrag(user.id, fragId, true, -1);
    if (!frag) {
        // TODO: Error
        return res.status(500).end();
    }
    // Validate fragsAvailable
    const value = parseInt(fragsAvailable, 10);
    if (isNaN(value) || value < 0) {
        // TODO: Error
        return res.status(500).end();
    }
    // Now update it
    db.updateFragsAvailable(user.id, fragId, value);
    res.json({
        success: true,
        fragsAvailable: value
    });
});

//-----------------------------------------------------------------------------
// Giving a frag
//-----------------------------------------------------------------------------

router.post('/give-a-frag', upload.single('picture'), async (req, res) => {
    // 'file' is added by multer and has all the information about the
    // uploaded file if one was present
    const {user, body, file} = req;
    const picture = file ? file.filename : null;
    // Validate
    const {fragOf, ownerId} = body;
    console.log('give-a-frag', user, body);
    // Validate the frag. It must belong to this user and be alive. It must
    // have > 0 frags available
    const frag = db.validateFrag(user.id, fragOf, true, 0);
    if (!frag) {
        // TODO: Error
        return res.status(500).end();
    }
    // Now make sure the new owner is allowed
    // TODO: no way to find whether the recipient is a supporting member
    /*
    const recipient = await lookupUser(ownerId);
    if (!(recipient && recipient.allowed)) {
        // TODO: Error
        return res.status(500).end();
    }
    */
    // Inputs from the form
    const params = {
        ...body,
        picture
    };
    // Do it
    const fragsAvailable = db.giveAFrag(user.id, params);
    // Reply
    res.json({
        success: true,
        fragsAvailable
    });
});

//-----------------------------------------------------------------------------
// TODO: Belongs in a '/user' API
//-----------------------------------------------------------------------------

router.get('/find-users', async (req, res) => {
    const {query} = req;
    const {prefix} = query;
    const fullUsers = await findUsersWithPrefix(prefix);
    // Make it smaller, only returning [[id, name],...]
    const users = fullUsers.map(({id, name}) => [id, name]);
    res.json({
        users
    });
});

//-----------------------------------------------------------------------------

module.exports = router;