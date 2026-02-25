import * as InboxSDK from '@inboxsdk/core';

// Register the application ID at https://www.inboxsdk.com/register
const APP_ID = 'sdk_gmail-xsearch01_98bf02340a';
var currentListView = null;

InboxSDK.load(2, APP_ID).then(function (sdk) {
  // Add a thread search button
  sdk.Toolbars.registerThreadButton({
    title: "Search Thread",
    iconUrl: chrome.runtime.getURL("icons/st128.png"),
    positions: ["ROW"],
    //listSection: sdk.Toolbars.SectionNames.OTHER,
    onClick: (event) => runSearchQueryFG(event, sdk)
  });

  // Add a thread open button
  sdk.Toolbars.registerThreadButton({
    title: "Open Thread",
    iconUrl: chrome.runtime.getURL("icons/ot128.png"),
    positions: ["ROW"],
    //listSection: sdk.Toolbars.SectionNames.OTHER,
    onClick: (event) => runOpenThreadFG(event, sdk)
  });

  // Add a thread delete button
  sdk.Toolbars.registerThreadButton({
    title: "Delete Thread",
    iconUrl: chrome.runtime.getURL("icons/dt128.png"),
    positions: ["ROW"],
    //listSection: sdk.Toolbars.SectionNames.OTHER,
    onClick: (event) => runDeleteThreadFG(event, sdk)
  });

  sdk.Router.handleListRoute(sdk.Router.NativeListRouteIDs.ANY_LIST, function (routeView) {
    // Save the current list view for potential refresh
    currentListView = routeView;
  });
});

function getThreadDesc(event) {
  // Get the thread view of the event
  const threadView = event.selectedThreadRowViews ? event.selectedThreadRowViews[0] : null;
  if (!threadView) {
    alert('No thread view for the selected event');
    return null;
  }

  // Get the thread ID of the current view
  const threadID = threadView.getThreadID();
  if (!threadID) {
    alert('No thread ID for the selected message thread');
    return null;
  }

  // Get the subject of the current view
  const strSubject = threadView.getSubject();
  if (!strSubject) {
    alert('No subject for the selected message thread');
    return null;
  }

  return {
    threadID: threadID,
    strSubject: strSubject
  };
}

function runSearchQueryFG(event, /*sdk*/) {
  const threadDesc = getThreadDesc(event);
  if (!threadDesc) {
    return;
  }

  // Send a message to the background page to run the search
  chrome.runtime.sendMessage({
    action: "search",
    threadID: threadDesc.threadID,
    subject: threadDesc.strSubject
  });
}

function runOpenThreadFG(event, /*sdk*/) {
  const threadDesc = getThreadDesc(event);
  if (!threadDesc) {
    return;
  }

  // Send a message to the background page to open the thread
  chrome.runtime.sendMessage({
    action: "open",
    threadID: threadDesc.threadID,
    subject: threadDesc.strSubject
  });
}

function runDeleteThreadFG(event, /*sdk*/) {
  if (!window.confirm('Do you really want to delete this thread?')) {
    return;
  }

  const threadDesc = getThreadDesc(event);
  if (!threadDesc) {
    return;
  }

  // Send a message to the background page to delete the thread
  // Wait for the response to arrive after the deletion
  (async () => {
    const response = await chrome.runtime.sendMessage({
      action: "delete",
      threadID: threadDesc.threadID,
      subject: threadDesc.strSubject
    });

    if (!response) {
      window.alert('Unknown error deleting thread');
      return;
    }

    // Response contains the delete query URL or error
    if (response.error) {
      window.alert('Error deleting thread: ' + response.error);
      return
    }
    console.log('Refreshing route:', currentListView.getRouteType(), 'after:', response);

    if (currentListView) {
      currentListView.refresh();
    } else {
      window.alert('Failed to refresh the current view');
    }
  })();
}
