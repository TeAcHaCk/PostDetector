// Main content script - orchestrates detection and highlighting
(function () {
    'use strict';


    let extractor, highlighter, observer;
    let flaggedPosts = new Set();
    let processedPosts = new Set();
    let currentUrl = window.location.href;
    let navigationCheckInterval = null;

    // Initialize extension
    async function init() {
        // Initialize components
        extractor = new PostIDExtractor();
        highlighter = new PostHighlighter();

        console.log('[Post Detector] Initializing on', extractor.platform);

        // Load flagged posts from backend
        await loadFlaggedPosts();

        // Schedule multiple scans to catch late-loading posts
        scheduleMultipleScans();

        // Start observing for new posts
        observer = new PostObserver(handleNewPost);
        observer.start();

        // Start navigation detection for SPA navigation
        startNavigationDetection();

        console.log('[Post Detector] Initialization complete');
    }

    // Detect SPA navigation (URL changes without page reload)
    function startNavigationDetection() {
        // Method 1: Override History API
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            handleNavigation();
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            handleNavigation();
        };

        // Method 2: Listen for popstate (back/forward navigation)
        window.addEventListener('popstate', handleNavigation);

        // Method 3: Polling fallback for other navigation methods
        navigationCheckInterval = setInterval(() => {
            if (window.location.href !== currentUrl) {
                handleNavigation();
            }
        }, 1000);

        console.log('[Post Detector] Navigation detection started');
    }

    // Handle navigation to new page
    async function handleNavigation() {
        const newUrl = window.location.href;

        // Skip if URL hasn't actually changed
        if (newUrl === currentUrl) return;

        console.log('[Post Detector] Navigation detected:', currentUrl, '->', newUrl);
        currentUrl = newUrl;

        // Clear processed posts (new page, new posts)
        processedPosts.clear();

        // Re-fetch flagged posts (in case new ones were added)
        await loadFlaggedPosts();

        // Wait a bit for new page content to load, then do multiple scans
        setTimeout(() => {
            // Schedule multiple scans to catch late-loading posts
            scheduleMultipleScans();
            console.log('[Post Detector] Page rescanned after navigation');
        }, 300);
    }

    // Load flagged posts from backend
    async function loadFlaggedPosts() {
        try {
            const data = await chrome.runtime.sendMessage({
                action: 'fetchFlaggedPosts',
                platform: extractor.platform
            });

            if (!data.success && data.error) {
                // If it's a fetch error handled by background script
                throw new Error(data.error);
            }

            if (data.posts) {
                flaggedPosts = new Set(data.posts.map(p => p.postId));
                console.log(`[Post Detector] ✅ Loaded ${flaggedPosts.size} flagged posts from backend`);

                // Store in chrome.storage for offline access
                if (chrome.storage) {
                    chrome.storage.local.set({
                        [`flaggedPosts_${extractor.platform}`]: Array.from(flaggedPosts)
                    });
                }
            }
        } catch (error) {
            // Provide more specific error information
            if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
                console.warn('[Post Detector] ⚠️ Backend is offline or unreachable. Using cached data.');
                console.warn('[Post Detector] Make sure backend server is running on http://127.0.0.1:3000');
            } else {
                console.error('[Post Detector] Error loading flagged posts:', error.message);
            }

            // Try to load from local storage as fallback
            if (chrome.storage) {
                chrome.storage.local.get([`flaggedPosts_${extractor.platform}`], (result) => {
                    const cached = result[`flaggedPosts_${extractor.platform}`];
                    if (cached && cached.length > 0) {
                        flaggedPosts = new Set(cached);
                        console.log(`[Post Detector] 📦 Loaded ${flaggedPosts.size} flagged posts from cache`);
                    } else {
                        console.log('[Post Detector] No cached data available. Extension will work in local-only mode.');
                    }
                });
            }
        }
    }

    // Scan and highlight existing posts on the page
    function scanExistingPosts() {
        const posts = findAllPosts();
        console.log(`[Post Detector] Found ${posts.length} existing posts to scan`);
        console.log(`[Post Detector] Flagged posts in memory:`, Array.from(flaggedPosts));

        let highlightedCount = 0;
        posts.forEach(post => {
            const result = processPost(post);
            if (result?.highlighted) highlightedCount++;
        });

        console.log(`[Post Detector] Highlighted ${highlightedCount} flagged posts`);
    }

    // Schedule multiple scans to catch late-loading content
    function scheduleMultipleScans() {
        // Immediate scan
        scanExistingPosts();

        // Retry scans at intervals to catch lazy-loaded content
        const retryDelays = [500, 1500, 3000];
        retryDelays.forEach(delay => {
            setTimeout(() => {
                console.log(`[Post Detector] Retry scan after ${delay}ms`);
                scanExistingPosts();
            }, delay);
        });
    }

    // Find all post elements on current page
    function findAllPosts() {
        let elements = [];

        switch (extractor.platform) {
            case 'facebook':
                // Strategy 1: aria-posinset (feed items)
                let feedItems = document.querySelectorAll('[aria-posinset]');
                if (feedItems.length > 0) {
                    elements = Array.from(feedItems);
                    console.log(`[Post Detector] Found ${elements.length} posts via aria-posinset`);
                    break;
                }

                // Strategy 2: FeedUnit pagelets
                const feedUnits = document.querySelectorAll('[data-pagelet*="FeedUnit"]');
                if (feedUnits.length > 0) {
                    elements = Array.from(feedUnits);
                    console.log(`[Post Detector] Found ${elements.length} posts via FeedUnit`);
                    break;
                }

                // Strategy 3: Search results - look for feed container children
                const feedContainer = document.querySelector('div[role="feed"]');
                if (feedContainer) {
                    // Get direct children of feed that contain post-like links
                    const feedChildren = feedContainer.querySelectorAll(':scope > div');
                    feedChildren.forEach(child => {
                        const hasPostLink = child.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="multi_permalinks="], a[href*="/groups/"]');
                        if (hasPostLink) {
                            elements.push(child);
                        }
                    });
                    if (elements.length > 0) {
                        console.log(`[Post Detector] Found ${elements.length} posts via feed container`);
                        break;
                    }
                }

                // Strategy 4: Articles with post links (most inclusive)
                const articles = document.querySelectorAll('div[role="article"]');
                const seenElements = new Set();
                articles.forEach(article => {
                    const parentArticle = article.parentElement?.closest('div[role="article\"]');
                    if (!parentArticle) {
                        const hasPostLink = article.querySelector(
                            'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="story_fbid="], a[href*="multi_permalinks="]'
                        );
                        if (hasPostLink && !seenElements.has(article)) {
                            elements.push(article);
                            seenElements.add(article);
                        }
                    }
                });

                // Strategy 5: Any container with post links (last resort for search results)
                if (elements.length === 0) {
                    const allPostLinks = document.querySelectorAll(
                        'a[href*="/posts/"], a[href*="story_fbid="], a[href*="multi_permalinks="], a[href*="/permalink.php"]'
                    );
                    allPostLinks.forEach(link => {
                        // Find a reasonable parent container
                        let container = link.closest('[class*="x1yztbdb"]') ||
                            link.closest('[class*="x1lliihq"]') ||
                            link.closest('div[data-ad-preview]')?.parentElement ||
                            link.parentElement?.parentElement?.parentElement;
                        if (container && !seenElements.has(container)) {
                            elements.push(container);
                            seenElements.add(container);
                        }
                    });
                    console.log(`[Post Detector] Found ${elements.length} posts via post links fallback`);
                } else {
                    console.log(`[Post Detector] Found ${elements.length} posts via articles`);
                }
                break;
            case 'instagram':
                elements = Array.from(document.querySelectorAll('article'));
                break;
            case 'twitter':
                elements = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
                break;
            case 'linkedin':
                elements = Array.from(document.querySelectorAll('.feed-shared-update-v2'));
                break;
            default:
                return [];
        }

        return elements;
    }

    // Handle new post detected by observer
    function handleNewPost(postElement) {
        processPost(postElement);
    }

    // Process a single post
    function processPost(postElement) {
        const postId = extractor.extractPostID(postElement);

        if (!postId) return { highlighted: false, postId: null };

        // Skip if already processed
        if (processedPosts.has(postId)) return { highlighted: false, postId, skipped: true };
        processedPosts.add(postId);

        // For Facebook, find the correct main post container (not comments)
        let targetElement = postElement;
        if (extractor.platform === 'facebook') {
            targetElement = findFacebookMainPost(postElement);
            if (!targetElement) {
                console.log(`[Post Detector] Could not find main post container for ID: ${postId}`);
                return { highlighted: false, postId };
            }
        }

        // Mark post element with ID for reference
        targetElement.setAttribute('data-post-id', postId);

        // Highlight if flagged
        const isFlagged = flaggedPosts.has(postId);
        if (isFlagged) {
            console.log(`[Post Detector] ✅ Highlighting flagged post: ${postId}`);
            highlighter.highlightPost(targetElement, 'impersonation');
            highlighter.pulseHighlight(targetElement);
            return { highlighted: true, postId };
        }

        return { highlighted: false, postId };
    }

    // Find the main Facebook post container (not comment section)
    function findFacebookMainPost(element) {
        // Strategy 1: Look for aria-posinset (Facebook feed item marker)
        // This is the most reliable selector for individual posts in the feed
        const feedItem = element.closest('[aria-posinset]');
        if (feedItem) {
            console.log('[Post Detector] Found post via aria-posinset');
            return feedItem;
        }

        // Strategy 2: Look for FeedUnit pagelet
        const feedUnit = element.closest('[data-pagelet*="FeedUnit"]');
        if (feedUnit) {
            console.log('[Post Detector] Found post via FeedUnit pagelet');
            return feedUnit;
        }

        // Strategy 3: Walk up to find the topmost article with a post link
        let current = element;
        let topArticle = null;

        while (current && current !== document.body) {
            if (current.matches && current.matches('div[role="article"]')) {
                // Check if this article has a post link (real posts have these)
                const hasPostLink = current.querySelector(
                    'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch"]'
                );

                // Also check it's not inside another article (to get the topmost one)
                const parentArticle = current.parentElement?.closest('div[role="article"]');

                if (hasPostLink && !parentArticle) {
                    topArticle = current;
                    break; // Found the topmost article with post link
                } else if (hasPostLink) {
                    topArticle = current; // Keep looking for a higher one
                }
            }
            current = current.parentElement;
        }

        if (topArticle) {
            console.log('[Post Detector] Found post via topmost article');
            return topArticle;
        }

        console.log('[Post Detector] Using original element');
        return element;
    }

    // Track the element that was right-clicked
    let lastRightClickedElement = null;

    document.addEventListener('contextmenu', (e) => {
        lastRightClickedElement = e.target;
    }, true);

    // Handle Context Menu Flag Command
    function handleContextMenuFlag() {
        if (!lastRightClickedElement) {
            showNotification('Could not identify the post. Please try again.', 'error');
            return;
        }

        // Find the closest post container
        const postElement = findClosestPostElement(lastRightClickedElement);

        if (!postElement) {
            showNotification('No social media post found at this location.', 'error');
            return;
        }

        processAndFlagPost(postElement);
    }

    // Handle Popup "Flag Current" Command
    function handlePopupFlag() {
        // Try to identify the post in the viewport or current URL
        const posts = findAllPosts();

        if (posts.length === 0) {
            showNotification('No posts detected on this page.', 'error');
            return;
        }

        // If only one post (permalink view), flag it
        if (posts.length === 1) {
            processAndFlagPost(posts[0]);
            return;
        }

        // If multiple posts (feed), find the most visible one
        const visiblePost = posts.find(post => {
            const rect = post.getBoundingClientRect();
            return rect.top >= 0 && rect.top < window.innerHeight / 2;
        });

        if (visiblePost) {
            processAndFlagPost(visiblePost);
        } else {
            showNotification('Please right-click the specific post you want to flag.', 'info');
        }
    }

    // Find closest post element from a child
    function findClosestPostElement(element) {
        let selector;
        switch (extractor.platform) {
            case 'facebook':
                return element.closest('div[role="article"], [data-pagelet*="FeedUnit"]');
            case 'instagram':
                return element.closest('article');
            case 'twitter':
                return element.closest('article[data-testid="tweet"]');
            case 'linkedin':
                return element.closest('.feed-shared-update-v2');
            default:
                return null;
        }
    }

    // Process and flag a post (wrapper for existing logic)
    function processAndFlagPost(postElement) {
        const postId = extractor.extractPostID(postElement);
        if (!postId) {
            showNotification('Could not extract Post ID.', 'error');
            return;
        }

        // Check if already flagged
        if (flaggedPosts.has(postId)) {
            showNotification('This post is already flagged.', 'info');
            highlighter.highlightPost(postElement, 'impersonation');
            return;
        }

        // Flag it
        flagPost(postId, postElement);
    }

    // Flag a post as impersonation
    async function flagPost(postId, postElement) {
        try {
            showNotification('⏳ Flagging post...', 'info');

            const postUrl = window.location.href;
            const platform = extractor.platform;

            const response = await chrome.runtime.sendMessage({
                action: 'flagPost',
                data: {
                    postId,
                    platform,
                    url: postUrl,
                    timestamp: new Date().toISOString()
                }
            });

            if (!response.success && response.error) {
                throw new Error(response.error);
            }

            // Update local state
            flaggedPosts.add(postId);

            // Update chrome storage
            if (chrome.storage) {
                chrome.storage.local.set({
                    [`flaggedPosts_${platform}`]: Array.from(flaggedPosts)
                });
            }

            // Highlight the post
            highlighter.highlightPost(postElement, 'impersonation');
            highlighter.pulseHighlight(postElement);

            // Show notification
            showNotification('✓ Post flagged successfully!', 'success');

            // Notify background script to update badge
            if (chrome.runtime) {
                chrome.runtime.sendMessage({
                    action: 'postFlagged',
                    postId,
                    platform
                });
            }

            console.log('[Post Detector] Post flagged:', postId);
        } catch (error) {
            console.error('[Post Detector] Error flagging post:', error);
            showNotification(error.message || 'Failed to flag post.', 'error');
        }
    }

    // Show notification to user
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `impersonation-notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Listen for messages from popup/background
    if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'refreshFlaggedPosts') {
                loadFlaggedPosts().then(() => {
                    // Re-scan posts with new data
                    const posts = findAllPosts();
                    posts.forEach(post => {
                        const postId = post.getAttribute('data-post-id');
                        if (postId && flaggedPosts.has(postId) && !post.classList.contains('impersonation-highlighted')) {
                            highlighter.highlightPost(post, 'impersonation');
                        }
                    });
                    sendResponse({ success: true });
                });
                return true; // Async response
            } else if (request.action === 'getPageStats') {
                sendResponse({
                    totalPosts: processedPosts.size,
                    flaggedCount: Array.from(processedPosts).filter(id => flaggedPosts.has(id)).length,
                    platform: extractor.platform
                });
            } else if (request.action === 'contextMenuFlag') {
                handleContextMenuFlag();
                sendResponse({ success: true });
            } else if (request.action === 'popupFlag') {
                handlePopupFlag();
                sendResponse({ success: true });
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
