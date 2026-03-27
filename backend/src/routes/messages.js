const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// POST /api/messages - send a message
router.post('/', auth, (req, res) => {
  const { receiver_id, product_id, content } = req.body;
  const sender_id = req.user.id;

  // Validate required fields
  if (!receiver_id || !content) {
    return err(res, 400, 'receiver_id and content are required', 'validation_error');
  }

  // Sanitize content to prevent XSS
  const sanitizedContent = content
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#x27;')
    .trim();

  if (!sanitizedContent) {
    return err(res, 400, 'Message content cannot be empty', 'validation_error');
  }

  // Check if receiver exists
  const receiver = db.prepare('SELECT id FROM users WHERE id = ?').get(receiver_id);
  if (!receiver) {
    return err(res, 404, 'Receiver not found', 'not_found');
  }

  // Prevent sending message to self
  if (sender_id === receiver_id) {
    return err(res, 400, 'Cannot send message to yourself', 'validation_error');
  }

  try {
    const stmt = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, product_id, content) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(sender_id, receiver_id, product_id || null, sanitizedContent);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: message });
  } catch (e) {
    err(res, 500, 'Failed to send message: ' + e.message, 'server_error');
  }
});

// GET /api/messages/conversations - list conversation threads
router.get('/conversations', auth, (req, res) => {
  const userId = req.user.id;

  try {
    // Get all unique conversations with last message and unread count
    const conversations = db.prepare(`
      SELECT 
        CASE 
          WHEN m.sender_id = ? THEN m.receiver_id 
          ELSE m.sender_id 
        END as other_user_id,
        u.name as other_user_name,
        u.avatar_url as other_user_avatar,
        m.content as last_message,
        m.created_at as last_message_at,
        (SELECT COUNT(*) FROM messages 
         WHERE sender_id = other_user_id 
         AND receiver_id = ? 
         AND read_at IS NULL) as unread_count
      FROM messages m
      JOIN users u ON u.id = CASE 
        WHEN m.sender_id = ? THEN m.receiver_id 
        ELSE m.sender_id 
      END
      WHERE m.id IN (
        SELECT MAX(id) FROM messages 
        WHERE sender_id = ? OR receiver_id = ?
        GROUP BY CASE 
          WHEN sender_id = ? THEN receiver_id 
          ELSE sender_id 
        END
      )
      ORDER BY m.created_at DESC
    `).all(userId, userId, userId, userId, userId, userId);

    res.json({ success: true, data: conversations });
  } catch (e) {
    err(res, 500, 'Failed to fetch conversations: ' + e.message, 'server_error');
  }
});

// GET /api/messages/:userId - get messages with a specific user
router.get('/:userId', auth, (req, res) => {
  const currentUserId = req.user.id;
  const otherUserId = parseInt(req.params.userId, 10);

  if (isNaN(otherUserId)) {
    return err(res, 400, 'Invalid user ID', 'validation_error');
  }

  try {
    // Mark messages from other user as read
    db.prepare(`
      UPDATE messages 
      SET read_at = CURRENT_TIMESTAMP 
      WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
    `).run(otherUserId, currentUserId);

    // Get messages between the two users
    const messages = db.prepare(`
      SELECT m.*, 
        s.name as sender_name, 
        r.name as receiver_name
      FROM messages m
      JOIN users s ON s.id = m.sender_id
      JOIN users r ON r.id = m.receiver_id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `).all(currentUserId, otherUserId, otherUserId, currentUserId);

    res.json({ success: true, data: messages });
  } catch (e) {
    err(res, 500, 'Failed to fetch messages: ' + e.message, 'server_error');
  }
});

// PATCH /api/messages/:id/read - mark as read
router.patch('/:id/read', auth, (req, res) => {
  const messageId = parseInt(req.params.id, 10);
  const userId = req.user.id;

  if (isNaN(messageId)) {
    return err(res, 400, 'Invalid message ID', 'validation_error');
  }

  try {
    // Only allow marking messages where user is the receiver
    const result = db.prepare(`
      UPDATE messages 
      SET read_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND receiver_id = ? AND read_at IS NULL
    `).run(messageId, userId);

    if (result.changes === 0) {
      return err(res, 404, 'Message not found or already read', 'not_found');
    }

    res.json({ success: true, message: 'Message marked as read' });
  } catch (e) {
    err(res, 500, 'Failed to mark message as read: ' + e.message, 'server_error');
  }
});

// GET /api/messages/unread/count - get unread message count
router.get('/unread/count', auth, (req, res) => {
  const userId = req.user.id;

  try {
    const result = db.prepare(`
      SELECT COUNT(*) as count 
      FROM messages 
      WHERE receiver_id = ? AND read_at IS NULL
    `).get(userId);

    res.json({ success: true, count: result.count });
  } catch (e) {
    err(res, 500, 'Failed to fetch unread count: ' + e.message, 'server_error');
  }
});

module.exports = router;
