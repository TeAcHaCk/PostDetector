// Main content script - orchestrates detection and highlighting
(function() {
  'use strict';

  const API_URL = 'http://localhost:3000/api'; // Update with your backend URL
  const extractor = new PostIDExtractor();
  const highlighter = new PostHighlighter();
  let flaggedPosts = new Set();
  let processedPosts = new Set();

  // Initialize extension
  async function init() {
    console.log('[Impersonation Detector] Initializing on', extractor.platform);
    
    // Load flagged posts from backend
    await loadFlaggedPosts();
    
    // Scan existing posts on page
    scanExistingPosts();
    
    // Start observing for new posts
    startObserving();
    
    // Add flag buttons to all posts
    addFlagButtons();
  }

  // Load flagged posts from backend
  async function loadFlaggedPosts() {
    try {
      const response = await fetch(`${API_URL}/posts/flagged?platform=${extractor.platform}`);
      if (!response.ok) throw new Error('Failed to load flagged posts');
      
      const data = await response.json();
      flaggedPosts = new Set(data.posts.map(p => p.postId));
      
      console.log(`[Impersonation Detector] Loaded ${flaggedPosts.size} flagged posts`);
    } catch (error) {
      console.error('[Impersonation Detector] Error loading flagged posts:', error);
    }
  }

  // Scan and highlight existing posts on the page
  function scanExistingPosts() {
    const posts = findAllPosts();
    console.log(`[Impersonation Detector] Found ${posts.length} posts to scan`);
    
    posts.forEach(post => processPost(post));
  }

  // Find all post elements on current page
  function findAllPosts() {
    let selector;
    switch (extractor.platform) {
      case 'facebook':
        selector = 'div[role="article"], [data-pagelet*="FeedUnit"]';
        break;
      case 'instagram':
        selector = 'article';
        break;
      case 'twitter':
        selector = 'article[data-testid="tweet"]';
        break;
      case 'linkedin':
        selector = '.feed-shared-update-v2';
        break;
      default:
        return [];
    }
    return Array.from(document.querySelectorAll(selector));
  }

  // Process a single post
  function processPost(postElement) {
    const postId = extractor.extractPostID(postElement);
    
    if (!postId) return;
    
    // Skip if already processed
    if (processedPosts.has(postId)) return;
    processedPosts.add(postId);
    
    // Mark post element with ID for reference
    postElement.setAttribute('data-post-id', postId);
    
    // Highlight if flagged
    if (flaggedPosts.has(postId)) {
      highlighter.highlightPost(postElement, 'impersonation');
    }
    
    // Add flag button
    addFlagButton(postElement, postId);
  }

  // Add flag buttons to posts
  function addFlagButtons() {
    const posts = findAllPosts();
    posts.forEach(post => {
      const postId = post.getAttribute('data-post-id');
      if (postId && !post.querySelector('.impersonation-flag-btn')) {
        addFlagButton(post, postId);
      }
    });
  }

  // Add flag button to a specific post
  function addFlagButton(postElement, postId) {
    if (postElement.querySelector('.impersonation-flag-btn')) return;
    
    const button = document.createElement('button');
    button.className = 'impersonation-flag-btn';
    button.innerHTML = '⚠️ Flag as Impersonation';
    button.title = 'Report this post as impersonation';
    
    const isFlagged = flaggedPosts.has(postId);
    if (isFlagged) {
      button.innerHTML = '✓ Flagged as Impersonation';
      button.classList.add('already-flagged');
      button.disabled = true;
    }
    
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await flagPost(postId, postElement, button);
    });
    
    // Insert button at appropriate location based on platform
    insertFlagButton(postElement, button);
  }

  // Insert flag button at the right location
  function insertFlagButton(postElement, button) {
    switch (extractor.platform) {
      case 'facebook':
        // Try to find action bar (like, comment, share area)
        const fbActionBar = postElement.querySelector('[role="toolbar"], [aria-label*="actions"]');
        if (fbActionBar) {
          fbActionBar.appendChild(button);
        } else {
          postElement.appendChild(button);
        }
        break;
      
      case 'instagram':
        // Insert after the action buttons (like, comment, share)
        const igActions = postElement.querySelector('section:last-of-type');
        if (igActions) {
          igActions.appendChild(button);
        } else {
          postElement.appendChild(button);
        }
        break;
      
      case 'twitter':
        // Insert in the tweet actions area
        const twtActions = postElement.querySelector('[role="group"]');
        if (twtActions) {
          twtActions.appendChild(button);
        } else {
          postElement.appendChild(button);
        }
        break;
      
      default:
        postElement.appendChild(button);
    }
  }

  // Flag a post as impersonation
  async function flagPost(postId, postElement, button) {
    try {
      button.disabled = true;
      button.innerHTML = '⏳ Flagging...';
      
      const postUrl = window.location.href;
      const platform = extractor.platform;
      
      const response = await fetch(`${API_URL}/posts/flag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postId,
          platform,
          url: postUrl,
          timestamp: new Date().toISOString()
        })
      });
      
      if (!response.ok) throw new Error('Failed to flag post');
      
      const result = await response.json();
      
      // Update local state
      flaggedPosts.add(postId);
      
      // Highlight the post
      highlighter.highlightPost(postElement, 'impersonation');
      
      // Update button
      button.innerHTML = '✓ Flagged Successfully';
      button.classList.add('already-flagged');
      
      // Show notification
      showNotification('Post flagged successfully!', 'success');
      
      console.log('[Impersonation Detector] Post flagged:', postId);
    } catch (error) {
      console.error('[Impersonation Detector] Error flagging post:', error);
      button.disabled = false;
      button.innerHTML = '⚠️ Flag as Impersonation';
      showNotification('Failed to flag post. Please try again.', 'error');
    }
  }

  // Start observing DOM for new posts
  function startObserving() {
    const observer = new MutationObserver((mutations) => {
      const newPosts = [];
      
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the node itself is a post
            const postContainer = extractor.findPostContainer(node);
            if (postContainer && !processedPosts.has(extractor.extractPostID(postContainer))) {
              newPosts.push(postContainer);
            }
            
            // Check for posts within the added node
            const posts = findAllPosts();
            posts.forEach(post => {
              const postId = extractor.extractPostID(post);
              if (postId && !processedPosts.has(postId)) {
                newPosts.push(post);
              }
            });
          }
        });
      });
      
      // Process new posts
      newPosts.forEach(post => processPost(post));
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    console.log('[Impersonation Detector] Started observing for new posts');
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
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshFlaggedPosts') {
      loadFlaggedPosts().then(() => {
        scanExistingPosts();
        sendResponse({ success: true });
      });
      return true; // Async response
    }
  });

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();