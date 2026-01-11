// Popup functionality for Post Detector Extension

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize popup
    await loadPageStats();
    await loadGlobalStats();
    await loadSettings();

    // Setup event listeners
    setupEventListeners();
});

// Load statistics from current page
async function loadPageStats() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) return;

        // Check if tab is a supported social media site
        const url = tab.url;
        const isSocialMedia =
            url.includes('facebook.com') ||
            url.includes('instagram.com') ||
            url.includes('twitter.com') ||
            url.includes('x.com') ||
            url.includes('linkedin.com');

        if (!isSocialMedia) {
            document.getElementById('totalPosts').textContent = 'N/A';
            document.getElementById('flaggedCount').textContent = 'N/A';
            document.getElementById('platformName').textContent = 'Not supported';
            return;
        }

        // Query content script for stats
        const response = await sendMessageToActiveTab('getPageStats', {}, false); // false = don't show full screen error for stats, just fallback

        if (response) {
            document.getElementById('totalPosts').textContent = response.totalPosts || 0;
            document.getElementById('flaggedCount').textContent = response.flaggedCount || 0;
            document.getElementById('platformName').textContent =
                response.platform ? capitalizeFirst(response.platform) : 'Unknown';
        } else {
            // Handle case where content script is not ready but we don't want to block UI
            console.log('Content script not ready or page not supported');
        }
    } catch (error) {
        console.error('Error loading page stats:', error);
        document.getElementById('totalPosts').textContent = '?';
        document.getElementById('flaggedCount').textContent = '?';
        document.getElementById('platformName').textContent = 'Error';
    }
}

// Load global statistics
async function loadGlobalStats() {
    try {
        const stats = await chrome.runtime.sendMessage({ action: 'getStats' });

        const globalStatsEl = document.getElementById('globalStats');

        if (!stats.success) {
            // Show local stats if backend is unavailable
            if (stats.local && stats.local.totalFlagged !== undefined) {
                globalStatsEl.innerHTML = `
          <div class="global-stat-item">
            <span class="global-stat-label">Total Reports:</span>
            <span class="global-stat-value">${stats.local.totalFlagged}</span>
          </div>
          <div class="info-message">⚠️ Backend offline - showing local data</div>
        `;
            } else {
                globalStatsEl.innerHTML = '<div class="error-message">Unable to load statistics</div>';
            }
            return;
        }

        // Display backend stats
        let html = '';
        if (stats.stats && stats.stats.length > 0) {
            stats.stats.forEach(platformStat => {
                html += `
          <div class="platform-stat">
            <div class="platform-stat-header">${capitalizeFirst(platformStat._id)}</div>
            <div class="platform-stat-body">
              <span>Total: ${platformStat.totalPosts}</span>
              <span>Confirmed: ${platformStat.confirmedPosts}</span>
              <span>Pending: ${platformStat.pendingPosts}</span>
            </div>
          </div>
        `;
            });
        } else {
            html = '<div class="info-message">No flagged posts yet</div>';
        }

        if (stats.totalReports !== undefined) {
            html += `
        <div class="total-reports">
          <strong>Total Community Reports:</strong> ${stats.totalReports}
        </div>
      `;
        }

        globalStatsEl.innerHTML = html;
    } catch (error) {
        console.error('Error loading global stats:', error);
        document.getElementById('globalStats').innerHTML =
            '<div class="error-message">Error loading statistics</div>';
    }
}

// Load user settings
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get(['settings', 'stats']);

        if (result.settings) {
            document.getElementById('enableHighlighting').checked =
                result.settings.enableHighlighting !== false;
            document.getElementById('showNotifications').checked =
                result.settings.showNotifications !== false;
        }

        if (result.stats && result.stats.lastSync) {
            const lastSync = new Date(result.stats.lastSync);
            document.getElementById('lastSync').textContent = formatRelativeTime(lastSync);
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Scan Page button - Primary action
    document.getElementById('scanPageBtn').addEventListener('click', async () => {
        const btn = document.getElementById('scanPageBtn');
        const originalText = btn.querySelector('.btn-text').textContent;

        try {
            // Update button to show scanning
            btn.disabled = true;
            btn.querySelector('.btn-text').textContent = 'Scanning...';
            btn.querySelector('.btn-icon').textContent = '⏳';
            showStatus('Scanning page for flagged posts...', 'info');

            // First refresh flagged posts from backend
            await sendMessageToActiveTab('refreshFlaggedPosts');

            // Then trigger a full page scan
            const response = await sendMessageToActiveTab('scanPage');

            if (response) {
                const { scannedCount, highlightedCount } = response;
                showStatus(`Scanned ${scannedCount} posts, found ${highlightedCount} flagged`, 'success');

                // Update stats display
                await loadPageStats();
            } else {
                showStatus('Scan complete', 'success');
            }
        } catch (error) {
            console.error('Error scanning page:', error);
            showStatus('Failed to scan page', 'error');
        } finally {
            // Restore button
            btn.disabled = false;
            btn.querySelector('.btn-text').textContent = originalText;
            btn.querySelector('.btn-icon').textContent = '🔍';
        }
    });

    // Flag button
    document.getElementById('flagBtn').addEventListener('click', async () => {
        showStatus('Sending flag command...', 'info');

        try {
            const response = await sendMessageToActiveTab('popupFlag');
            if (response) {
                showStatus('Command sent!', 'success');
                // Close popup to let user see the result
                setTimeout(() => window.close(), 1000);
            }
        } catch (error) {
            console.error('Error flagging:', error);
            showStatus('Failed to send command', 'error');
        }
    });

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        showStatus('Refreshing...', 'info');

        try {
            await sendMessageToActiveTab('refreshFlaggedPosts');

            await loadPageStats();
            await loadGlobalStats();

            showStatus('Refreshed successfully!', 'success');
        } catch (error) {
            console.error('Error refreshing:', error);
            showStatus('Failed to refresh', 'error');
        }
    });

    // Sync button
    document.getElementById('syncBtn').addEventListener('click', async () => {
        showStatus('Syncing all platforms...', 'info');

        try {
            await chrome.runtime.sendMessage({ action: 'syncFlaggedPosts' });
            await loadGlobalStats();

            // Update last sync time
            const result = await chrome.storage.local.get(['stats']);
            if (result.stats && result.stats.lastSync) {
                const lastSync = new Date(result.stats.lastSync);
                document.getElementById('lastSync').textContent = formatRelativeTime(lastSync);
            }

            showStatus('Sync complete!', 'success');
        } catch (error) {
            console.error('Error syncing:', error);
            showStatus('Sync failed', 'error');
        }
    });

    // Settings toggles
    document.getElementById('enableHighlighting').addEventListener('change', async (e) => {
        await updateSetting('enableHighlighting', e.target.checked);
    });

    document.getElementById('showNotifications').addEventListener('change', async (e) => {
        await updateSetting('showNotifications', e.target.checked);
    });
}

// Update a setting
async function updateSetting(key, value) {
    try {
        const result = await chrome.storage.local.get(['settings']);
        const settings = result.settings || {};
        settings[key] = value;

        await chrome.runtime.sendMessage({
            action: 'updateSettings',
            settings
        });

        showStatus('Setting updated', 'success');
    } catch (error) {
        console.error('Error updating setting:', error);
        showStatus('Failed to update setting', 'error');
    }
}

// Show status message
function showStatus(message, type) {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type} show`;

    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 2000);
}

// Utility: Send message to active tab safely
async function sendMessageToActiveTab(action, data = {}, showError = true) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return null;

        return await chrome.tabs.sendMessage(tab.id, { action, ...data });
    } catch (error) {
        if (error.message.includes('Receiving end does not exist') ||
            error.message.includes('Could not establish connection')) {
            if (showError) showRefreshUI();
            return null;
        }
        throw error;
    }
}

// Show "Please Refresh" UI
function showRefreshUI() {
    const mainContent = document.querySelector('.container'); // Assuming body has a container or just append to body

    // Check if already showing
    if (document.getElementById('refresh-warning')) return;

    const warning = document.createElement('div');
    warning.id = 'refresh-warning';
    warning.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.95);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        text-align: center;
        padding: 20px;
    `;

    warning.innerHTML = `
        <div style="font-size: 40px; margin-bottom: 20px;">🔄</div>
        <h3 style="margin-bottom: 10px; color: #333;">Connection Lost</h3>
        <p style="margin-bottom: 20px; color: #666; font-size: 14px;">The extension was reloaded. Please refresh this page to reconnect.</p>
        <button id="params-refresh-btn" class="action-btn primary" style="width: auto;">Refresh Page</button>
    `;

    document.body.appendChild(warning);

    document.getElementById('params-refresh-btn').addEventListener('click', () => {
        chrome.tabs.reload();
        window.close();
    });
}

// Utility: Capitalize first letter
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Utility: Format relative time
function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
}
