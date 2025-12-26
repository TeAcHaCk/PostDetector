// DOM Observer - Watches for new posts being added to the page
class PostObserver {
    constructor(onNewPost) {
        this.onNewPost = onNewPost;
        this.observer = null;
        this.debounceTimer = null;
        this.pendingNodes = new Set();
    }

    // Start observing DOM mutations
    start() {
        if (this.observer) {
            console.warn('[Observer] Already observing');
            return;
        }

        this.observer = new MutationObserver((mutations) => {
            this.handleMutations(mutations);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('[Observer] Started observing DOM for new posts');
    }

    // Stop observing
    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
            console.log('[Observer] Stopped observing');
        }
    }

    // Handle mutation events with debouncing
    handleMutations(mutations) {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    this.pendingNodes.add(node);
                }
            });
        });

        // Debounce processing to avoid excessive calls
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.processPendingNodes();
        }, 300);
    }

    // Process accumulated nodes
    processPendingNodes() {
        if (this.pendingNodes.size === 0) return;

        const nodes = Array.from(this.pendingNodes);
        this.pendingNodes.clear();

        nodes.forEach((node) => {
            // Find all posts within this node and its children
            this.findPostsInNode(node);
        });
    }

    // Find post elements within a node
    findPostsInNode(node) {
        const hostname = window.location.hostname;
        const isFacebook = hostname.includes('facebook.com');

        // Check if the node itself is a valid post
        if (this.isValidPost(node, isFacebook)) {
            this.onNewPost(node);
        }

        // Platform-specific selectors
        const selectors = isFacebook
            ? ['[aria-posinset]', '[data-pagelet*="FeedUnit"]', 'div[role="article"]']
            : [
                'article',                        // Instagram, Twitter
                'article[data-testid="tweet"]',  // Twitter/X
                '.feed-shared-update-v2'         // LinkedIn
            ];

        // Check for posts within the node
        selectors.forEach(selector => {
            try {
                const posts = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                posts.forEach(post => {
                    if (this.isValidPost(post, isFacebook)) {
                        this.onNewPost(post);
                    }
                });
            } catch (e) {
                // Selector might not be valid for all nodes
            }
        });
    }

    // Check if element is a valid main post (not a comment)
    isValidPost(element, isFacebook) {
        if (!element || !element.matches) return false;

        try {
            // For Facebook, filter out comments (nested articles)
            if (isFacebook) {
                // Best: aria-posinset marks individual feed items
                if (element.matches('[aria-posinset]')) {
                    return true;
                }
                if (element.matches('[data-pagelet*="FeedUnit"]')) {
                    return true;
                }
                if (element.matches('div[role="article"]')) {
                    // Reject if nested inside another article (it's a comment)
                    const parentArticle = element.parentElement?.closest('div[role="article"]');
                    if (parentArticle) return false;

                    // Must have a post link to be a real post
                    const hasPostLink = element.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/reel/"]');
                    return !!hasPostLink;
                }
                return false;
            }

            // Other platforms
            return element.matches('article, article[data-testid="tweet"], .feed-shared-update-v2');
        } catch (e) {
            return false;
        }
    }

    // Manually trigger a scan of current page
    scanNow() {
        this.findPostsInNode(document.body);
    }
}

// Export for use in other scripts
window.PostObserver = PostObserver;
