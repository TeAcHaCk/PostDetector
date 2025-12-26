// Backend Server for Impersonation Detector
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/impersonation-detector';

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*', // In production, restrict to your extension ID
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// MongoDB Schema
const PostSchema = new mongoose.Schema({
  postId: {
    type: String,
    required: true,
    index: true
  },
  platform: {
    type: String,
    required: true,
    enum: ['facebook', 'instagram', 'twitter', 'linkedin'],
    index: true
  },
  url: {
    type: String,
    required: true
  },
  flagCount: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'dismissed'],
    default: 'pending'
  },
  firstReported: {
    type: Date,
    default: Date.now
  },
  lastReported: {
    type: Date,
    default: Date.now
  },
  reporters: [{
    ipHash: String,
    timestamp: Date
  }]
}, {
  timestamps: true
});

// Compound index for efficient queries
PostSchema.index({ platform: 1, postId: 1 }, { unique: true });

const Post = mongoose.model('Post', PostSchema);

// Report Schema (for tracking individual reports)
const ReportSchema = new mongoose.Schema({
  postId: {
    type: String,
    required: true,
    index: true
  },
  platform: {
    type: String,
    required: true
  },
  reporterIpHash: String,
  reason: String,
  additionalInfo: String
}, {
  timestamps: true
});

const Report = mongoose.model('Report', ReportSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Utility: Hash IP for privacy
const crypto = require('crypto');
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Get all flagged posts (with optional platform filter)
app.get('/api/posts/flagged', async (req, res) => {
  try {
    const { platform } = req.query;
    const query = { status: { $in: ['pending', 'confirmed'] } };

    if (platform) {
      query.platform = platform;
    }

    const posts = await Post.find(query)
      .select('postId platform url flagCount status')
      .lean();

    res.json({
      success: true,
      count: posts.length,
      posts
    });
  } catch (error) {
    console.error('Error fetching flagged posts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// Flag a post
app.post('/api/posts/flag', async (req, res) => {
  try {
    const { postId, platform, url, reason, additionalInfo } = req.body;

    // Validation
    if (!postId || !platform || !url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: postId, platform, url'
      });
    }

    const ipHash = hashIP(req.ip);

    // Check if post already exists
    let post = await Post.findOne({ postId, platform });

    if (post) {
      // Check if this IP has already reported this post
      const alreadyReported = post.reporters.some(r => r.ipHash === ipHash);

      if (alreadyReported) {
        return res.status(400).json({
          success: false,
          error: 'You have already reported this post'
        });
      }

      // Update existing post
      post.flagCount += 1;
      post.lastReported = new Date();
      post.reporters.push({ ipHash, timestamp: new Date() });

      // Auto-confirm if enough reports
      if (post.flagCount >= 3 && post.status === 'pending') {
        post.status = 'confirmed';
      }

      await post.save();
    } else {
      // Create new flagged post
      post = new Post({
        postId,
        platform,
        url,
        flagCount: 1,
        status: 'pending',
        reporters: [{ ipHash, timestamp: new Date() }]
      });
      await post.save();
    }

    // Create report record
    const report = new Report({
      postId,
      platform,
      reporterIpHash: ipHash,
      reason,
      additionalInfo
    });
    await report.save();

    res.json({
      success: true,
      post: {
        postId: post.postId,
        platform: post.platform,
        flagCount: post.flagCount,
        status: post.status
      }
    });
  } catch (error) {
    console.error('Error flagging post:', error);
    res.status(500).json({ success: false, error: 'Failed to flag post' });
  }
});

// Get details of a specific post
app.get('/api/posts/:platform/:postId', async (req, res) => {
  try {
    const { platform, postId } = req.params;

    const post = await Post.findOne({ platform, postId })
      .select('-reporters.ipHash')
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    res.json({ success: true, post });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

// Admin: Update post status
app.put('/api/admin/posts/:platform/:postId/status', async (req, res) => {
  try {
    const { platform, postId } = req.params;
    const { status } = req.body;

    if (!['pending', 'confirmed', 'dismissed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const post = await Post.findOneAndUpdate(
      { platform, postId },
      { status },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    res.json({ success: true, post });
  } catch (error) {
    console.error('Error updating post status:', error);
    res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await Post.aggregate([
      {
        $group: {
          _id: '$platform',
          totalPosts: { $sum: 1 },
          confirmedPosts: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          pendingPosts: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          totalFlags: { $sum: '$flagCount' }
        }
      }
    ]);

    const totalReports = await Report.countDocuments();

    res.json({
      success: true,
      stats,
      totalReports
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 MongoDB: ${MONGODB_URI}`);
});

module.exports = app;