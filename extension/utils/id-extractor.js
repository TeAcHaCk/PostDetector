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
    // Method 1: Check for data attributes
    const storyID = element.querySelector('[data-store-id]')?.getAttribute('data-store-id');
    if (storyID) return storyID;

    // Method 2: Find links within the post
    const links = element.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/"], a[href*="/story.php"]');
    for (const link of links) {
      const href = link.getAttribute('href');

      // Patterns
      const patterns = [
        /\/posts\/(\d+)/,
        /\/permalink\/(\d+)/,
        /story_fbid=(\d+)/,
        /\/videos\/(\d+)/,
        /\/reel\/(\d+)/,
        /\/watch\/\?v=(\d+)/,
        /fbid=(\d+)/
      ];

      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match) return match[1];
      }
    }

    // Method 3: Check current URL
    const url = window.location.href;
    const urlPatterns = [
      /\/posts\/(\d+)/,
      /\/permalink\/(\d+)/,
      /\/videos\/(\d+)/,
      /\/reel\/(\d+)/,
      /story_fbid=(\d+)/,
      /fbid=(\d+)/
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