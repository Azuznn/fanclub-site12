const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// セキュリティとCORS設定
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
        },
    },
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// アップロードディレクトリの作成
const createUploadsDir = async () => {
    const uploadsDir = path.join(__dirname, 'uploads');
    try {
        await fs.access(uploadsDir);
    } catch {
        await fs.mkdir(uploadsDir, { recursive: true });
    }
};

// 画像アップロード設定
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('画像ファイルのみアップロード可能です'));
        }
    }
});

// データベース初期化
const db = new sqlite3.Database('fanclub.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

const initializeDatabase = () => {
    // ユーザーテーブル
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // ファンクラブテーブル
    db.run(`CREATE TABLE IF NOT EXISTS fanclubs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        monthly_fee INTEGER NOT NULL DEFAULT 0,
        purpose TEXT,
        cover_image_url TEXT,
        owner_id INTEGER NOT NULL,
        member_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users (id)
    )`);

    // メンバーシップテーブル
    db.run(`CREATE TABLE IF NOT EXISTS memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        fanclub_id INTEGER NOT NULL,
        is_owner BOOLEAN DEFAULT FALSE,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        next_payment_date DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (fanclub_id) REFERENCES fanclubs (id),
        UNIQUE(user_id, fanclub_id)
    )`);

    // 投稿テーブル
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fanclub_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        excerpt TEXT,
        featured_image_url TEXT,
        visibility TEXT CHECK(visibility IN ('public', 'members')) DEFAULT 'public',
        like_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (fanclub_id) REFERENCES fanclubs (id),
        FOREIGN KEY (author_id) REFERENCES users (id)
    )`);

    // いいねテーブル
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (post_id) REFERENCES posts (id),
        UNIQUE(user_id, post_id)
    )`);

    // コメントテーブル
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts (id),
        FOREIGN KEY (author_id) REFERENCES users (id)
    )`);

    // リマインダー設定テーブル
    db.run(`CREATE TABLE IF NOT EXISTS reminder_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        email_enabled BOOLEAN DEFAULT TRUE,
        days_before INTEGER DEFAULT 3,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id)
    )`);
};

// JWT認証ミドルウェア
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'アクセストークンが必要です' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '無効なトークンです' });
        }
        req.user = user;
        next();
    });
};

// ユーザー認証API
app.post('/api/auth/signup', async (req, res) => {
    const { nickname, email, phone, password } = req.body;

    if (!nickname || !email || !password) {
        return res.status(400).json({ error: '必須項目が不足しています' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (nickname, email, phone, password_hash) VALUES (?, ?, ?, ?)',
            [nickname, email, phone, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed: users.email')) {
                        return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
                    }
                    return res.status(500).json({ error: 'ユーザー作成エラー' });
                }

                const userId = this.lastID;
                const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '24h' });

                // リマインダー設定のデフォルト値を作成
                db.run('INSERT INTO reminder_settings (user_id) VALUES (?)', [userId]);

                res.status(201).json({
                    message: 'ユーザーが作成されました',
                    token,
                    user: { id: userId, nickname, email, phone }
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'メールアドレスとパスワードが必要です' });
    }

    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'データベースエラー' });
            }

            if (!user) {
                return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
            }

            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
            }

            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
            
            res.json({
                message: 'ログイン成功',
                token,
                user: {
                    id: user.id,
                    nickname: user.nickname,
                    email: user.email,
                    phone: user.phone,
                    avatar_url: user.avatar_url
                }
            });
        }
    );
});

// ファンクラブAPI
app.get('/api/fanclubs', (req, res) => {
    const query = `
        SELECT f.*, u.nickname as owner_name 
        FROM fanclubs f 
        JOIN users u ON f.owner_id = u.id 
        ORDER BY f.created_at DESC
    `;
    
    db.all(query, (err, fanclubs) => {
        if (err) {
            return res.status(500).json({ error: 'データベースエラー' });
        }
        res.json(fanclubs);
    });
});

app.get('/api/fanclubs/search', (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: '検索クエリが必要です' });
    }

    const query = `
        SELECT f.*, u.nickname as owner_name 
        FROM fanclubs f 
        JOIN users u ON f.owner_id = u.id 
        WHERE f.name LIKE ? OR f.description LIKE ? OR f.purpose LIKE ?
        ORDER BY f.created_at DESC
    `;
    
    const searchTerm = `%${q}%`;
    db.all(query, [searchTerm, searchTerm, searchTerm], (err, fanclubs) => {
        if (err) {
            return res.status(500).json({ error: 'データベースエラー' });
        }
        res.json(fanclubs);
    });
});

app.get('/api/fanclubs/:id', (req, res) => {
    const query = `
        SELECT f.*, u.nickname as owner_name 
        FROM fanclubs f 
        JOIN users u ON f.owner_id = u.id 
        WHERE f.id = ?
    `;
    
    db.get(query, [req.params.id], (err, fanclub) => {
        if (err) {
            return res.status(500).json({ error: 'データベースエラー' });
        }
        if (!fanclub) {
            return res.status(404).json({ error: 'ファンクラブが見つかりません' });
        }
        res.json(fanclub);
    });
});

app.post('/api/fanclubs', authenticateToken, (req, res) => {
    const { name, description, monthly_fee, purpose, cover_image_url } = req.body;

    if (!name || !purpose) {
        return res.status(400).json({ error: '必須項目が不足しています' });
    }

    db.run(
        'INSERT INTO fanclubs (name, description, monthly_fee, purpose, cover_image_url, owner_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name, description, monthly_fee || 0, purpose, cover_image_url, req.user.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'ファンクラブ作成エラー' });
            }

            const fanclubId = this.lastID;

            // オーナーをメンバーとして追加
            db.run(
                'INSERT INTO memberships (user_id, fanclub_id, is_owner) VALUES (?, ?, TRUE)',
                [req.user.id, fanclubId],
                (err) => {
                    if (err) {
                        console.error('メンバーシップ作成エラー:', err);
                    }
                }
            );

            res.status(201).json({
                message: 'ファンクラブが作成されました',
                id: fanclubId
            });
        }
    );
});

// メンバーシップAPI
app.post('/api/fanclubs/:id/join', authenticateToken, (req, res) => {
    const fanclubId = req.params.id;
    const userId = req.user.id;

    // 既にメンバーかチェック
    db.get(
        'SELECT * FROM memberships WHERE user_id = ? AND fanclub_id = ?',
        [userId, fanclubId],
        (err, existing) => {
            if (err) {
                return res.status(500).json({ error: 'データベースエラー' });
            }
            if (existing) {
                return res.status(400).json({ error: '既にこのファンクラブのメンバーです' });
            }

            // メンバーシップを作成
            const nextPaymentDate = new Date();
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

            db.run(
                'INSERT INTO memberships (user_id, fanclub_id, next_payment_date) VALUES (?, ?, ?)',
                [userId, fanclubId, nextPaymentDate.toISOString()],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'メンバーシップ作成エラー' });
                    }

                    // ファンクラブのメンバー数を更新
                    db.run(
                        'UPDATE fanclubs SET member_count = member_count + 1 WHERE id = ?',
                        [fanclubId],
                        (err) => {
                            if (err) {
                                console.error('メンバー数更新エラー:', err);
                            }
                        }
                    );

                    res.json({ message: 'ファンクラブに参加しました' });
                }
            );
        }
    );
});

app.delete('/api/fanclubs/:id/leave', authenticateToken, (req, res) => {
    const fanclubId = req.params.id;
    const userId = req.user.id;

    db.run(
        'DELETE FROM memberships WHERE user_id = ? AND fanclub_id = ? AND is_owner = FALSE',
        [userId, fanclubId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'データベースエラー' });
            }
            if (this.changes === 0) {
                return res.status(400).json({ error: '退会できませんでした' });
            }

            // ファンクラブのメンバー数を更新
            db.run(
                'UPDATE fanclubs SET member_count = member_count - 1 WHERE id = ?',
                [fanclubId],
                (err) => {
                    if (err) {
                        console.error('メンバー数更新エラー:', err);
                    }
                }
            );

            res.json({ message: 'ファンクラブから退会しました' });
        }
    );
});

// 投稿API
app.get('/api/fanclubs/:id/posts', (req, res) => {
    const fanclubId = req.params.id;
    const userId = req.query.user_id; // オプション: ユーザーIDがある場合のみメンバー限定投稿も表示

    let query = `
        SELECT p.*, u.nickname as author_name, u.avatar_url as author_avatar
        FROM posts p 
        JOIN users u ON p.author_id = u.id 
        WHERE p.fanclub_id = ?
    `;
    
    // ユーザーIDが提供されている場合、メンバーシップをチェック
    if (userId) {
        query += ` AND (p.visibility = 'public' OR 
            (p.visibility = 'members' AND EXISTS (
                SELECT 1 FROM memberships m 
                WHERE m.user_id = ? AND m.fanclub_id = ?
            )))`;
    } else {
        query += ` AND p.visibility = 'public'`;
    }
    
    query += ` ORDER BY p.published_at DESC`;

    const params = userId ? [fanclubId, userId, fanclubId] : [fanclubId];
    
    db.all(query, params, (err, posts) => {
        if (err) {
            return res.status(500).json({ error: 'データベースエラー' });
        }
        res.json(posts);
    });
});

app.post('/api/fanclubs/:id/posts', authenticateToken, (req, res) => {
    const { title, content, excerpt, featured_image_url, visibility } = req.body;
    const fanclubId = req.params.id;

    if (!title || !content) {
        return res.status(400).json({ error: 'タイトルと内容が必要です' });
    }

    // オーナーかチェック
    db.get(
        'SELECT * FROM memberships WHERE user_id = ? AND fanclub_id = ? AND is_owner = TRUE',
        [req.user.id, fanclubId],
        (err, membership) => {
            if (err) {
                return res.status(500).json({ error: 'データベースエラー' });
            }
            if (!membership) {
                return res.status(403).json({ error: '投稿権限がありません' });
            }

            db.run(
                'INSERT INTO posts (fanclub_id, author_id, title, content, excerpt, featured_image_url, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [fanclubId, req.user.id, title, content, excerpt, featured_image_url, visibility || 'public'],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: '投稿作成エラー' });
                    }
                    res.status(201).json({
                        message: '投稿が作成されました',
                        id: this.lastID
                    });
                }
            );
        }
    );
});

// 画像アップロードAPI
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '画像ファイルが必要です' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({
        message: '画像がアップロードされました',
        url: imageUrl
    });
});

// ユーザー情報API
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get(
        'SELECT id, nickname, email, phone, avatar_url, created_at FROM users WHERE id = ?',
        [req.user.id],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'データベースエラー' });
            }
            if (!user) {
                return res.status(404).json({ error: 'ユーザーが見つかりません' });
            }
            res.json(user);
        }
    );
});

app.put('/api/user/profile', authenticateToken, (req, res) => {
    const { nickname, email, phone, avatar_url } = req.body;

    db.run(
        'UPDATE users SET nickname = ?, email = ?, phone = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [nickname, email, phone, avatar_url, req.user.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'プロフィール更新エラー' });
            }
            res.json({ message: 'プロフィールが更新されました' });
        }
    );
});

// メインページの提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// エラーハンドリング
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'ファイルサイズが大きすぎます（最大10MB）' });
        }
    }
    res.status(500).json({ error: 'サーバーエラー' });
});

// 404エラー
app.use((req, res) => {
    res.status(404).json({ error: 'ページが見つかりません' });
});

// サーバー起動
const startServer = async () => {
    await createUploadsDir();
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
};

startServer().catch(console.error);

// graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Database close error:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});