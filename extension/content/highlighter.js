// Post Highlighter - Visual highlighting of flagged posts
class PostHighlighter {
  constructor() {
    this.highlightedPosts = new Map();
    this.platform = this.detectPlatform();
  }

  detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('facebook.com')) return 'facebook';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('linkedin.com')) return 'linkedin';
    return 'unknown';
  }

  // Highlight a post with specified type
  highlightPost(postElement, type = 'impersonation') {
    if (!postElement) return;

    const postId = postElement.getAttribute('data-post-id');
    if (!postId) return;

    // Prevent duplicate highlighting
    if (this.highlightedPosts.has(postId)) return;

    // For Facebook, find the correct container (not comments)
    let targetElement = postElement;
    if (this.platform === 'facebook') {
      targetElement = this.findFacebookPostContainer(postElement, postId);
    }

    if (!targetElement) {
      console.warn(`[Highlighter] Could not find container for post: ${postId}`);
      return;
    }

    // Add highlight class
    targetElement.classList.add('impersonation-highlighted', `highlight-${type}`);

    // Mark with post ID for tracking
    targetElement.setAttribute('data-highlighted-post-id', postId);

    // Add warning banner
    this.addWarningBanner(targetElement, type);

    // Track highlighted post
    this.highlightedPosts.set(postId, { type, element: targetElement });

    console.log(`[Highlighter] Highlighted post: ${postId}`);
  }

  // Find the correct Facebook post container (not the comment section)
  findFacebookPostContainer(element, postId) {
    // Strategy 0: If the element already has data-post-id or aria-posinset, it's already the correct container!
    // Facebook's native DOM structure uses these attributes on the proper post element
    if (element.hasAttribute('data-post-id')) {
      console.log('[Highlighter] Element already has data-post-id, using it directly');
      return element;
    }

    // Elements with aria-posinset are feed items - they ARE the container
    if (element.hasAttribute('aria-posinset')) {
      console.log('[Highlighter] Element has aria-posinset (feed item), using it directly');
      return element;
    }

    // Strategy 1: Look for aria-posinset (Facebook feed item marker) - most reliable
    const feedItem = element.closest('[aria-posinset]');
    if (feedItem) {
      console.log('[Highlighter] Found container via aria-posinset');
      return feedItem;
    }

    // Strategy 2: Try to find the FeedUnit pagelet
    const feedUnit = element.closest('[data-pagelet*="FeedUnit"]');
    if (feedUnit) {
      console.log('[Highlighter] Found container via FeedUnit');
      return feedUnit;
    }

    // Strategy 3: Find the topmost article that contains the post link
    // Walk up to find the outermost article element
    let current = element;
    let topArticle = null;

    while (current && current !== document.body) {
      if (current.matches && current.matches('div[role="article"]')) {
        // Check if this article contains the actual post (has a permalink)
        const hasPostLink = current.querySelector(
          'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch"]'
        );

        // Check it's not nested inside another article
        const parentArticle = current.parentElement?.closest('div[role="article"]');

        if (hasPostLink && !parentArticle) {
          topArticle = current;
          break;
        } else if (hasPostLink) {
          topArticle = current;
        }
      }
      current = current.parentElement;
    }

    if (topArticle) {
      console.log('[Highlighter] Found container via topmost article');
      return topArticle;
    }

    // Strategy 4: Use the element itself as fallback (it already has the data-post-id)
    console.log('[Highlighter] Using element itself as container');
    return element;
  }

  // Remove highlight from a post
  removeHighlight(postElement) {
    if (!postElement) return;

    const postId = postElement.getAttribute('data-post-id');
    if (!postId) return;

    // Remove classes
    postElement.classList.remove('impersonation-highlighted', 'highlight-impersonation');

    // Remove warning banner
    const banner = postElement.querySelector('.impersonation-warning-banner');
    if (banner) banner.remove();

    // Remove from tracking
    this.highlightedPosts.delete(postId);
  }

  // Add warning banner to post
  addWarningBanner(postElement, type) {
    // Check if banner already exists
    if (postElement.querySelector('.impersonation-warning-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'impersonation-warning-banner';

    const icon = document.createElement('span');
    icon.className = 'warning-icon';
    icon.innerHTML = '⚠️';

    const text = document.createElement('span');
    text.className = 'warning-text';
    text.textContent = this.getWarningText(type);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'warning-dismiss';
    dismissBtn.innerHTML = '×';
    dismissBtn.title = 'Dismiss warning';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      banner.style.display = 'none';
    });

    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(dismissBtn);

    // Insert banner at the top of the post
    postElement.insertBefore(banner, postElement.firstChild);
  }

  // Get warning text based on type
  getWarningText(type) {
    const messages = {
      impersonation: 'This post has been flagged as potential impersonation by the community.',
      spam: 'This post has been flagged as spam.',
      scam: 'This post has been flagged as a potential scam.',
      misinformation: 'This post has been flagged for potential misinformation.'
    };
    return messages[type] || 'This post has been flagged by the community.';
  }

  // Pulse animation for newly highlighted posts
  pulseHighlight(postElement) {
    if (!postElement) return;

    postElement.classList.add('highlight-pulse');
    setTimeout(() => {
      postElement.classList.remove('highlight-pulse');
    }, 1000);
  }

  // Get all currently highlighted posts
  getHighlightedPosts() {
    return Array.from(this.highlightedPosts.entries()).map(([id, data]) => ({
      id,
      type: data.type,
      element: data.element
    }));
  }

  // Clear all highlights
  clearAllHighlights() {
    this.highlightedPosts.forEach((data, postId) => {
      this.removeHighlight(data.element);
    });
    this.highlightedPosts.clear();
  }
}

// Export for use in other scripts
window.PostHighlighter = PostHighlighter;