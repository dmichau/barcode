BEGIN;
-------------------------------------------------------------------------------

PRAGMA user_version = 1;

-------------------------------------------------------------------------------
-- Enable foreign keys enforcement
-------------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-------------------------------------------------------------------------------
-- Items table
-------------------------------------------------------------------------------

CREATE TABLE items (
    itemId                  INTEGER PRIMARY KEY,
    name                    TEXT    NOT NULL,
    shortName               TEXT    NOT NULL,
    -- A link to a picture of the item in the site's
    -- static directory
    picture                 TEXT    NOT NULL,
    -- A link to the rules for borrowing this item
    rules                   TEXT    NOT NULL,
    -- A link to instructions for how to use this item
    instructions            TEXT    NOT NULL,
    -- The number of this item available to borrow
    quantity                INTEGER NOT NULL,
    -- How long the item can be borrowed for
    maxDays                 INTEGER NOT NULL,
    -- How many days you have to be a supporting member
    -- in order to borrow it.
    supportingMemberDays    INTEGER NOT NULL,
    -- A user that manages the item. They will be alerted
    -- when it is grossly overdue
    manager                 INTEGER NOT NULL,
    -- The number of days after the user receives the item
    -- that we start a conversation to facilitate the
    -- exchange. If it is zero, there will be
    -- no conversation started
    conversationStartDay    INTEGER NOT NULL,
    -- The number of waiting people to include in the conversation
    conversationWaiters     INTEGER NOT NULL,
    -- This is the day that we will start sending alerts
    -- If it is zero, no alerts will be sent
    alertStartDay           INTEGER NOT NULL,
    -- The maximum number of alerts that we will send before
    -- we alert the manager once. If it is zero,
    -- we won't alert the person who has it at all and will
    -- instead alert the manager once after maxDays
    maxAlerts               INTEGER NOT NULL
);

-------------------------------------------------------------------------------
-- Queue table
-------------------------------------------------------------------------------

CREATE TABLE queue (
    -- The item
    itemId              INTEGER NOT NULL,
    -- The timestamp the row was added
    timestamp           TEXT NOT NULL,
    -- The user
    userId              INTEGER NOT NULL,
    -- The user's phone number if they have the item
    phoneNumber         TEXT,
    -- The date the user received the item. If it is null, the user
    -- is waiting for the item
    dateReceived        TEXT,
    -- Whether the conversation has been started or not
    conversationStarted INTEGER NOT NULL DEFAULT 0,
    -- How many alerts we have sent the user
    alertsSent          INTEGER NOT NULL DEFAULT 0,
    -- Whether we have alerted the manager
    managerAlerted      INTEGER NOT NULL DEFAULT 0,

    UNIQUE (userId),
    FOREIGN KEY (itemId) REFERENCES items(itemId)
);

-------------------------------------------------------------------------------
-- Ban tiers
-------------------------------------------------------------------------------

CREATE TABLE banTiers (
    itemId              INTEGER NOT NULL,
    -- The tier/level - a number starting with 1
    tier                INTEGER NOT NULL,
    -- The number of days after which this ban takes effect
    afterDays           INTEGER NOT NULL,
    -- How many days to ban for. Zero is forever
    banDays             INTEGER NOT NULL,

    PRIMARY KEY (itemId, tier),
    FOREIGN KEY (itemId) REFERENCES items(itemId)
);

-------------------------------------------------------------------------------
-- Bans table
-------------------------------------------------------------------------------

CREATE TABLE bans (
    -- The user that is banned
    userId              INTEGER PRIMARY KEY,
    -- The type of ban, I'm thinking 'temporary', 'permanent' but leaving it
    -- open for others
    type                TEXT NOT NULL,
    -- Freeform text
    reason              TEXT NOT NULL,
    -- The user that issued it (could be barcode)
    issuedBy            INTEGER NOT NULL,
    -- The date the ban started
    startedOn           TEXT NOT NULL,
    -- The date the ban ends - ignore if it is permanent
    endsOn              TEXT NOT NULL
);

-------------------------------------------------------------------------------
-- OTP table
-------------------------------------------------------------------------------

CREATE TABLE otp (
    -- The user we sent the OTP to
    userId              INTEGER PRIMARY KEY,
    -- The OTP
    otp                 TEXT NOT NULL,
    -- The phone number it was sent to
    phoneNumber         TEXT NOT NULL,
    -- The time it was created
    created             TEXT NOT NULL,
    -- The time it was last sent
    sent                TEXT NOT NULL,
    -- How many times it has been sent
    count               INTEGER NOT NULL DEFAULT 1
);

-------------------------------------------------------------------------------

CREATE TABLE history (
    itemId              INTEGER NOT NULL,
    userId              INTEGER NOT NULL,
    startDate           TEXT NOT NULL,
    days                INTEGER NOT NULL,

    FOREIGN KEY (itemId) REFERENCES items(itemId)
);

-------------------------------------------------------------------------------

COMMIT;