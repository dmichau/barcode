
const {Database} = require('./db');

//-----------------------------------------------------------------------------

const DBTC_DB_VERSION = 1;

const db = new Database('dbtc', DBTC_DB_VERSION);

//-----------------------------------------------------------------------------
// Because sqlite's CURRENT_TIMESTAMP omits the 'Z' and just assumes UTC, we
// use this function instead, which always includes the timezone
//-----------------------------------------------------------------------------

function addTimestamp(values) {
    if (!values.timestamp) {
        values.timestamp = (new Date()).toISOString();
    }
    return values;
}

//-----------------------------------------------------------------------------
// All frags for a given user - joined with species
//-----------------------------------------------------------------------------

const SELECT_FRAGS_FOR_USER = `
    SELECT
        *,
        CASE WHEN frags.isAlive AND frags.fragsAvailable > 0
            THEN 1 ELSE 0 END AS isAvailable
    FROM
        mothers,
        frags
    WHERE
        frags.motherId = mothers.motherId AND
        frags.ownerId = $userId
    ORDER BY
        frags.dateAcquired DESC,
        mothers.name ASC
`;

function selectAllFragsForUser(user) {
    return db.all(SELECT_FRAGS_FOR_USER, {userId: user.id});
}

//-----------------------------------------------------------------------------

const SELECT_A_FRAG = `
    SELECT
        *,
        CASE WHEN frags.isAlive AND frags.fragsAvailable > 0
            THEN 1 ELSE 0 END AS isAvailable
    FROM
        mothers,
        frags
    WHERE
        frags.motherId = mothers.motherId AND
        frags.fragId = $fragId
`;

const SELECT_FRAG_JOURNALS = `
    SELECT
        *
    FROM
        journals
    WHERE
        journals.fragId = $fragId
    ORDER BY
        timestamp DESC
`;

function selectFrag(fragId) {
    const bindings = {
        fragId
    };
    const [frag] = db.all(SELECT_A_FRAG, bindings);
    const journals = db.all(SELECT_FRAG_JOURNALS, bindings);
    return [frag, journals];
}

//-----------------------------------------------------------------------------

const SELECT_MOTHERS = `
    SELECT
        *
    FROM
        mothers
    ORDER BY
        name ASC
`;

function selectMothers() {
    return db.all(SELECT_MOTHERS);
}

//-----------------------------------------------------------------------------

const INSERT_MOTHER = `
    INSERT INTO mothers
        (
            timestamp,
            name,
            type,
            scientificName,
            flow,
            light,
            hardiness,
            growthRate,
            sourceType,
            source,
            cost,
            size
        )
    VALUES
        (
            $timestamp,
            $name,
            $type,
            $scientificName,
            $flow,
            $light,
            $hardiness,
            $growthRate,
            $sourceType,
            $source,
            $cost,
            $size
        )
`;

const INSERT_FRAG = `
    INSERT INTO frags
        (
            timestamp,
            motherId,
            ownerId,
            dateAcquired,
            picture,
            notes,
            fragOf,
            fragsAvailable,
            isAlive
        )
    VALUES
        (
            $timestamp,
            $motherId,
            $ownerId,
            $dateAcquired,
            $picture,
            $notes,
            $fragOf,
            $fragsAvailable,
            1
        )
`;

const INSERT_ITEM_NULLABLE_VALUES = {
    scientificName: null,
    sourceType: null,
    source: null,
    size: null,
    picture: null,
    notes: null
};

function insertItem(values) {
    return db.transaction(({run}) => {
        const bindings = {
            ...INSERT_ITEM_NULLABLE_VALUES,
            ...values
        };
        const motherId = run(INSERT_MOTHER, addTimestamp(bindings));
        console.log('MOTHER ID', motherId);
        const fragBindings = {
            ...bindings,
            motherId,
            fragOf: null
        };
        console.log(fragBindings);
        const fragId = run(INSERT_FRAG, addTimestamp(fragBindings));
        return fragId;
    });
}

const DECREMENT_FRAGS_AVAILABLE = `
    UPDATE
        frags
    SET
        fragsAvailable = MAX(fragsAvailable - 1, 0)
    WHERE
        fragId = $fragId AND
        ownerId = $ownerId
`;

const SELECT_FRAGS_AVAILABLE = `
    SELECT
        fragsAvailable
    FROM
        frags
        WHERE
        fragId = $fragId AND
        ownerId = $ownerId
`;

// give a frag to someone else. userId is the one that is
// giving the frag
//
// values.ownerId is the recipient
// values.fragOf is the ID of the source frag

const INSERT_FRAG_NULLABLE_VALUES = {
    picture: null,
    notes: null
};

function giveAFrag(userId, values) {
    return db.transaction(({run, all}) => {
        // Insert into the frags table
        const fragBindings = {
            ...INSERT_FRAG_NULLABLE_VALUES,
            ...values,
            fragsAvailable: 0
        };
        console.log('GIVING FRAG', fragBindings);
        const fragId = run(INSERT_FRAG, addTimestamp(fragBindings));

        // Decrement available frags on the source frag
        run(DECREMENT_FRAGS_AVAILABLE, {
            ownerId: userId,
            fragId: values.fragOf
        });

        // Now get the current number of frags available
        const [{fragsAvailable}] = all(SELECT_FRAGS_AVAILABLE, {
            ownerId: userId,
            fragId: values.fragOf
        });
        return [fragsAvailable, fragId];
    });
}

//-----------------------------------------------------------------------------
// Select everything about a frag given parameters - to validate the frag
//-----------------------------------------------------------------------------

const SELECT_VALID_FRAG = `
    SELECT
        *,
        CASE WHEN frags.isAlive AND frags.fragsAvailable > 0
            THEN 1 ELSE 0 END AS isAvailable
    FROM
        mothers,
        frags
    WHERE
        frags.fragId            = $fragId AND
        frags.motherId          = mothers.motherId AND
        frags.isAlive           = $isAlive AND
        frags.fragsAvailable    > $fragsAvailable AND
        frags.ownerId           = $ownerId
`;

// Returns undefined if the frag is not valid. Otherwise, returns
// the one and only row

function validateFrag(ownerId, fragId, isAlive, fragsAvailable) {
    const [frag] = db.all(SELECT_VALID_FRAG, {
        fragId,
        isAlive: isAlive ? 1 : 0,
        fragsAvailable,
        ownerId
    });
    return frag;
}

//-----------------------------------------------------------------------------
// Given an owner, frag ID and a new number for fragsAvailable
//-----------------------------------------------------------------------------

const UPDATE_FRAGS_AVAILABLE = `
    UPDATE
        frags
    SET
        fragsAvailable = MAX($fragsAvailable, 0)
    WHERE
        fragId = $fragId AND
        ownerId = $ownerId
`;

function updateFragsAvailable(ownerId, fragId, fragsAvailable) {
    db.transaction(({run, all}) => {
        run(UPDATE_FRAGS_AVAILABLE, {
            fragId,
            ownerId,
            fragsAvailable
        });
        const [{fragsAvailable: result}] = all(SELECT_FRAGS_AVAILABLE, {
            fragId,
            ownerId
        });
        return result;
    });
}

//-----------------------------------------------------------------------------

const INSERT_JOURNAL = `
    INSERT INTO journals (
        fragId,
        timestamp,
        entryType,
        picture,
        notes
    )
    VALUES (
        $fragId,
        $timestamp,
        $entryType,
        $picture,
        $notes
    )
`;

const SELECT_JOURNAL = `SELECT * FROM journals WHERE journalId = $journalId`;

const JOURNAL_NULLABLE_VALUES = {
    picture: null,
    notes: null
};

function addJournal(values) {
    return db.transaction(({run, all}) => {
        const journalId = run(INSERT_JOURNAL, addTimestamp({
            ...JOURNAL_NULLABLE_VALUES,
            ...values
        }));
        const [journal] = all(SELECT_JOURNAL, {journalId});
        return journal;
    });
}

//-----------------------------------------------------------------------------

const UPDATE_ALIVE = `
    UPDATE
        frags
    SET
        isAlive = 0,
        fragsAvailable = 0
    WHERE
        fragId = $fragId AND
        ownerId = ownerId
`;

function markAsDead(ownerId, fragId) {
    db.run(UPDATE_ALIVE, {fragId, ownerId});
}

//-----------------------------------------------------------------------------

const UPDATE_PICTURE = `
    UPDATE
        frags
    SET
        picture = $picture
    WHERE
        fragId = $fragId AND
        ownerId = $ownerId
`;

function updateFragPicture(ownerId, fragId, picture) {
    db.run(UPDATE_PICTURE, {ownerId, fragId, picture})
}

//-----------------------------------------------------------------------------

module.exports = {
    selectAllFragsForUser,
    selectMothers,
    insertItem,
    selectFrag,
    validateFrag,
    updateFragsAvailable,
    giveAFrag,
    addJournal,
    markAsDead,
    updateFragPicture
}
