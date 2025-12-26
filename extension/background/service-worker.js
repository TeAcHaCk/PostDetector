// Background Service Worker for Post Detector Extension

const API_URL = 'http://127.0.0.1:3000/api';



// Extension installation handler
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Background] Extension installed');

        // Initialize storage
        chrome.storage.local.set({
            settings: {
                enableHighlighting: true,
                confidenceThreshold: 1,
                showNotifications: true
            },
            stats: {
                totalFlagged: 0,
                lastSync: Date.now()
            }
        });
    } else if (details.reason === 'update') {
        console.log('[Background] Extension updated to version', chrome.runtime.getManifest().version);
    }

    // Create Context Menu
    chrome.contextMenus.create({
        id: "flag-post",
        title: "🚩 Flag as Impersonation",
        contexts: ["all"]
    }, () => {
        // Check for error (e.g. menu already exists)
        if (chrome.runtime.lastError) {
            console.log('[Background] Context menu creation warning:', chrome.runtime.lastError.message);
        }
    });
});

// Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "flag-post") {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "contextMenuFlag" })
                .catch(err => console.log('[Background] Failed to send context menu command:', err));
        }
    }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'postFlagged') {
        handlePostFlagged(request, sender);
        sendResponse({ success: true });
    } else if (request.action === 'getStats') {
        getGlobalStats().then(stats => sendResponse(stats));
        return true; // Async response
    } else if (request.action === 'syncFlaggedPosts') {
        syncAllPlatforms().then(() => sendResponse({ success: true }));
        return true; // Async response
    } else if (request.action === 'updateSettings') {
        updateSettings(request.settings).then(() => sendResponse({ success: true }));
        return true; // Async response
    } else if (request.action === 'fetchFlaggedPosts') {
        fetchFlaggedPosts(request.platform).then(data => sendResponse(data));
        return true; // Async response
    } else if (request.action === 'flagPost') {
        flagPost(request.data).then(data => sendResponse(data));
        return true; // Async response
    }
});

// Proxy function to fetch flagged posts
async function fetchFlaggedPosts(platform) {
    try {
        const response = await fetch(`${API_URL}/posts/flagged?platform=${platform}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Proxy function to flag a post
async function flagPost(data) {
    try {
        const response = await fetch(`${API_URL}/posts/flag`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to flag post');
        }
        return await response.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Handle post flagged event
async function handlePostFlagged(request, sender) {
    const { postId, platform } = request;

    // Update badge count for the tab
    if (sender.tab) {
        updateBadgeForTab(sender.tab.id);
    }

    // Update global stats
    chrome.storage.local.get(['stats'], (result) => {
        const stats = result.stats || { totalFlagged: 0 };
        stats.totalFlagged += 1;
        stats.lastSync = Date.now();
        chrome.storage.local.set({ stats });
    });

    console.log(`[Background] Post flagged: ${postId} on ${platform}`);
}

// Update badge count for a specific tab
async function updateBadgeForTab(tabId) {
    try {
        // Query content script for stats
        const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageStats' });

        if (response && response.flaggedCount > 0) {
            chrome.action.setBadgeText({
                text: response.flaggedCount.toString(),
                tabId: tabId
            });
            chrome.action.setBadgeBackgroundColor({
                color: '#ff6b6b',
                tabId: tabId
            });
        } else {
            chrome.action.setBadgeText({ text: '', tabId: tabId });
        }
    } catch (error) {
        // Content script might not be loaded yet
        console.log('[Background] Could not update badge:', error.message);
    }
}

// Get global statistics
async function getGlobalStats() {
    try {
        // Fetch from backend
        const response = await fetch(`${API_URL}/stats`);
        if (!response.ok) throw new Error('Failed to fetch stats');

        const data = await response.json();

        // Combine with local storage data
        return new Promise((resolve) => {
            chrome.storage.local.get(['stats'], (result) => {
                resolve({
                    ...data,
                    local: result.stats || {}
                });
            });
        });
    } catch (error) {
        console.error('[Background] Error fetching stats:', error);

        // Return local stats as fallback
        return new Promise((resolve) => {
            chrome.storage.local.get(['stats'], (result) => {
                resolve({
                    success: false,
                    local: result.stats || {},
                    error: error.message
                });
            });
        });
    }
}

// Sync flagged posts for all platforms
async function syncAllPlatforms() {
    const platforms = ['facebook', 'instagram', 'twitter', 'linkedin'];

    for (const platform of platforms) {
        try {
            const response = await fetch(`${API_URL}/posts/flagged?platform=${platform}`);
            if (!response.ok) continue;

            const data = await response.json();
            const flaggedPosts = data.posts.map(p => p.postId);

            // Store in chrome.storage
            await chrome.storage.local.set({
                [`flaggedPosts_${platform}`]: flaggedPosts
            });

            console.log(`[Background] Synced ${flaggedPosts.length} posts for ${platform}`);
        } catch (error) {
            console.error(`[Background] Error syncing ${platform}:`, error);
        }
    }

    // Update last sync time
    chrome.storage.local.get(['stats'], (result) => {
        const stats = result.stats || {};
        stats.lastSync = Date.now();
        chrome.storage.local.set({ stats });
    });
}

// Update user settings
async function updateSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ settings }, () => {
            console.log('[Background] Settings updated:', settings);

            // Notify all content scripts about settings change
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'settingsUpdated',
                        settings
                    }).catch(() => {
                        // Tab might not have content script loaded
                    });
                });
            });

            resolve();
        });
    });
}

// Periodic sync (every 30 minutes)
if (chrome.alarms) {
    try {
        chrome.alarms.create('syncFlaggedPosts', { periodInMinutes: 30 });

        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'syncFlaggedPosts') {
                console.log('[Background] Running periodic sync');
                syncAllPlatforms();
            }
        });
    } catch (e) {
        console.warn('[Background] Failed to create alarm:', e);
    }
} else {
    console.warn('[Background] chrome.alarms API not available');
}

// Tab update listener - update badge when tab changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        // Small delay to allow content script to initialize
        setTimeout(() => {
            updateBadgeForTab(tabId);
        }, 1000);
    }
});

// Tab activation listener - update badge when switching tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateBadgeForTab(activeInfo.tabId);
});

console.log('[Background] Service worker initialized');
