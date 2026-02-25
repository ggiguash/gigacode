// Import scripts to enable the necessary functionality:
// - InboxSDK: background.js
try {
    console.log('Importing scripts into the background page');
    importScripts("background.js");
} catch (e) {
    console.log(e);
}

// Register message listener
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Get the message fields
    const action = request.action;
    const strSubject = request.subject;
    const threadID = request.threadID;
    if (!action || !strSubject || !threadID) {
        console.log('Skipping message:', request);
        return;
    }

    // Process the message
    switch (action) {
        case 'search':
            runSearchQuery(threadID, strSubject);
            break;
        case 'open':
            runOpenThread(threadID, strSubject);
            break;
        case 'delete':
            // Return true to allow sending an async response
            runDeleteThread(threadID, strSubject, sendResponse);
            return true;
        default:
            console.log('Unsupported action:', action);
    }
});

// Examples of search query templates:
//
// https://groups.google.com/search/conversations?inOrg=true&q=subject%3A"${SUBJECT}"
// https://www.google.com/search?q="${SUBJECT}"
//
function runSearchQuery(threadID, strSubject) {
    // Read the search template from the storage
    chrome.storage.sync.get(['search_template'], (result) => {
        const search_template = result.search_template;
        if (!search_template) {
            console.log('Search query template is not defined');
            return;
        }
        // Replace the subject pattern in the query
        const newURL = search_template.replace('${SUBJECT}', strSubject);
        // Run the search query in a new tab next to the current one
        chrome.tabs.query({ active: true, currentWindow: true }, function (tab) {
            let index = -1;
            if (tab && tab[0]) {
                index = tab[0].index;
            }
            chrome.tabs.create({ url: newURL, index: index + 1 });
        });
    });
}

function runOpenThread(threadID, strSubject) {
    const encSub = encodeURIComponent(strSubject);
    const newURL = 'https://mail.google.com/mail/u/0/#search/subject%3A"' + encSub + '"';

    // Open the thread search results in the current tab
    chrome.tabs.update({ url: newURL });
}

function runDeleteThread(threadID, strSubject, sendResponse) {
    chrome.identity.getAuthToken({ interactive: true }, function (token) {
        if (chrome.runtime.lastError) {
            sendResponse({error: chrome.runtime.lastError.message});
            return;
        }

        const url = "https://gmail.googleapis.com/gmail/v1/users/me/threads/" + threadID + "/trash";
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            }
        })
        .then(() => {
            // Return response to the message sender to refresh the page
            sendResponse({url: url});
        })
        .catch(error => {
            sendResponse({error: error});
        });
    });
}
