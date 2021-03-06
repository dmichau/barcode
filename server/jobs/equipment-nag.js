
const _ = require('lodash');

const {lock} = require('../lock');
const db = require('../equipment-database');
const {dateFromIsoString, differenceInDays} = require('../dates');
const {lookupUser, getUserEmailAddress, startConversation} = require('../xenforo');
const {uberPost} = require('../forum');
const {renderMessage} = require('../messages');
const {sendSms} = require('../aws');

//-----------------------------------------------------------------------------

async function alert(item, entry, days) {
    const {dateReceived, userId, phoneNumber} = entry;
    // Lookup the user
    const user = await lookupUser(userId, true);
    // Log
    console.log('Will alert', user.name, dateReceived, days, 'days');

    //-------------------------------------------------------------------------
    // If they have a phone number, we will send a text
    //-------------------------------------------------------------------------
    if (phoneNumber) {
        try {
            const [, message] = await renderMessage('overdue-equipment-sms', {item, user, days});
            await sendSms(phoneNumber, message);
            console.log('Sent alert via SMS to', phoneNumber);
        }
        catch (error) {
            console.error('Failed to send SMS alert', user.name, phoneNumber, error);
        }
    }

    //-------------------------------------------------------------------------
    // Try email
    //-------------------------------------------------------------------------
    try {
        const email = await getUserEmailAddress(userId);
        console.log(email);
        // TODO: figure out AWS SES
    }
    catch (error) {
        console.error('Failed to send e-mail alert', user.name, email, error);
    }

    //-------------------------------------------------------------------------
    // Try a PM which may also send an e-mail
    //-------------------------------------------------------------------------
    try {
        const [title, message] = await renderMessage('overdue-equipment-pm', {item, user, days});
        await startConversation([userId], title, message, true);
        console.log('PM sent');
    }
    catch (error) {
        console.error('Failed to send PM to', user.name, error);
    }
}

//-----------------------------------------------------------------------------

lock('equipment-nag', async () => {
    const now = new Date();
    // Get all the items, using 0 as the user ID because we don't care
    // about caller-specific information
    const {items} = db.getAllItems(0);
    // Iterate over them
    for (const item of items) {
        const {itemId, alertStartDay} = item;
        // If this item is set to not alert, we skip the queue
        if (!alertStartDay) {
            continue;
        }
        // Get the queue for this item
        const queue = db.getQueue(itemId);
        // Iterate over the queue
        for (const entry of queue) {
            // Get the date received
            const {userId, dateReceived} = entry;
            // If it is not there, this user is waiting
            if (!dateReceived) {
                continue;
            }
            // If the user is the manager, we don't alert
            if (userId === item.manager) {
                continue;
            }
            // Otherwise, the user has it, so figure out how many days
            const days = differenceInDays(now, dateFromIsoString(dateReceived));
            // Not enough time to start sending alerts
            if (days < alertStartDay) {
                continue;
            }
            // Alert
            await alert(item, entry, days);
        }
    }
});