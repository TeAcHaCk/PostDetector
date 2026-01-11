// ID Extractor for different social media platforms
class PostIDExtractor {
  constructor() {
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

  extractPostID(element) {
    switch (this.platform) {
      case 'facebook':
        return this.extractFacebookID(element);
      case 'instagram':
        return this.extractInstagramID(element);
      case 'twitter':
        return this.extractTwitterID(element);
      case 'linkedin':
        return this.extractLinkedInID(element);
      default:
        return null;
    }
  }

  extractFacebookID(element) {
    // Method 0: Check for NATIVE data-post-id attribute (BEST - Facebook provides this directly!)
    // This is the most reliable method as Facebook explicitly marks posts with their IDs
    const nativePostId = element.getAttribute('data-post-id');
    if (nativePostId) {
      console.log(`[ID Extractor] Found native data-post-id: ${nativePostId}`);
      return nativePostId;
    }

    // Also check if the element has a child with data-post-id (for containers like aria-posinset)
    const childWithPostId = element.querySelector('[data-post-id]');
    if (childWithPostId) {
      const childPostId = childWithPostId.getAttribute('data-post-id');
      console.log(`[ID Extractor] Found child with data-post-id: ${childPostId}`);
      return childPostId;
    }

    // Method 1: Check for data-store-id attribute
    const storyID = element.querySelector('[data-store-id]')?.getAttribute('data-store-id');
    if (storyID) return storyID;

    // Method 2: Find links within the post - but be careful to only use links that belong to THIS post
    // not links from nested comments or other posts
    const links = element.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/"], a[href*="/story.php"], a[href*="/groups/"], a[href*="/photo"]');

    // Patterns to extract post IDs
    const patterns = [
      /\/posts\/([A-Za-z0-9]+)/,
      /\/permalink\/([A-Za-z0-9]+)/,
      /story_fbid=([A-Za-z0-9]+)/,  // Supports both numeric and pfbid format
      /\/videos\/([A-Za-z0-9]+)/,
      /\/reel\/([A-Za-z0-9]+)/,
      /\/watch\/\?v=([A-Za-z0-9]+)/,
      /fbid=([A-Za-z0-9]+)/,  // Supports both numeric and pfbid format
      /multi_permalinks=([A-Za-z0-9]+)/,  // Facebook Groups multi_permalinks
      /set=.*?([0-9]+)/  // Photo set IDs
    ];

    for (const link of links) {
      // CRITICAL: Verify this link belongs to THIS post, not a nested post/comment
      // Only apply this check if the element we're scanning is an article
      // For non-article elements (like aria-posinset containers), be more permissive

      const isElementAnArticle = element.matches && element.matches('div[role="article"]');

      if (isElementAnArticle) {
        const linkParentArticle = link.closest('div[role="article"]');

        // If link is in a DIFFERENT article that is NESTED INSIDE our element, skip it
        if (linkParentArticle && linkParentArticle !== element && element.contains(linkParentArticle)) {
          // This link is inside a nested comment/article within our post - skip it
          continue;
        }
      }

      const href = link.getAttribute('href');

      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match) return match[1];
      }
    }

    // Method 3: Check current URL (only for single-post views)
    const url = window.location.href;
    const urlPatterns = [
      /\/posts\/([A-Za-z0-9]+)/,
      /\/permalink\/([A-Za-z0-9]+)/,
      /\/videos\/([A-Za-z0-9]+)/,
      /\/reel\/([A-Za-z0-9]+)/,
      /story_fbid=([A-Za-z0-9]+)/,  // Supports both numeric and pfbid format
      /fbid=([A-Za-z0-9]+)/,  // Supports both numeric and pfbid format
      /multi_permalinks=([A-Za-z0-9]+)/,  // Facebook Groups multi_permalinks
      /set=.*?([0-9]+)/  // Photo set IDs
    ];

    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  extractInstagramID(element) {
    // Method 1: Article element
    const article = element.closest('article');
    // Continue even if no article (might be single post view)

    // Method 2: Find permalink
    const container = article || element;
    const links = container.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');

    for (const link of links) {
      const href = link.getAttribute('href');
      // Matches /p/, /reel/, /tv/ followed by ID
      const match = href.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (match) return match[2];
    }

    // Method 3: Check URL
    const urlMatch = window.location.href.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (urlMatch) return urlMatch[2];

    return null;
  }

  extractTwitterID(element) {
    // Method 1: Find article
    const article = element.closest('article');

    // Method 2: Find status link
    if (article) {
      const links = article.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const href = link.getAttribute('href');
        const match = href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }

    // Method 3: Check URL
    const urlMatch = window.location.href.match(/\/status\/(\d+)/);
    if (urlMatch) return urlMatch[1];

    return null;
  }

  extractLinkedInID(element) {
    const links = element.querySelectorAll('a[href*="/activity-"], a[href*="/posts/"], a[href*="/pulse/"]');
    for (const link of links) {
      const href = link.getAttribute('href');

      // Activity
      let match = href.match(/activity[:-](\d+)/);
      if (match) return match[1];

      // Post (slug-id)
      match = href.match(/\/posts\/[^\/]+-(\d+)/);
      if (match) return match[1];

      // Article/Pulse
      match = href.match(/\/pulse\/[^\/]+-(\d+)/);
      if (match) return match[1];
    }

    // Check URL
    const url = window.location.href;
    const activityMatch = url.match(/activity[:-](\d+)/);
    if (activityMatch) return activityMatch[1];

    return null;
  }

  // Find the post container element for a given child element
  findPostContainer(element) {
    switch (this.platform) {
      case 'facebook':
        // Facebook posts are typically in div[role="article"] or specific data attributes
        return element.closest('div[role="article"], [data-pagelet*="FeedUnit"]');

      case 'instagram':
        return element.closest('article');

      case 'twitter':
        return element.closest('article');

      case 'linkedin':
        return element.closest('.feed-shared-update-v2');

      default:
        return null;
    }
  }
}

// Export for use in other scripts
window.PostIDExtractor = PostIDExtractor;