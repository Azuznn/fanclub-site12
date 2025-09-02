const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

 app.set('trust proxy', true);

// 環境変数
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// 環境変数チェック
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Required environment variables are missing');
    console.error('SUPABASE_URL:', SUPABASE_URL ? 'Set' : 'Missing');
    console.error('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'Set' : 'Missing');
}

// Supabase初期化
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY 
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Cloudinary設定
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cloudinaryストレージ設定
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'fanclub-site',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto' }],
    },
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// セキュリティとCORS設定
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.quilljs.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.quilljs.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        },
    },
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100
});
app.use(limiter);

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

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
    console.log('Signup request received:', req.body);
    
    const { nickname, email, phone, password } = req.body;

    if (!nickname || !email || !password) {
        console.log('Missing required fields');
        return res.status(400).json({ error: '必須項目が不足しています' });
    }

    if (!supabase) {
        console.error('Supabase client not initialized');
        return res.status(500).json({ error: 'データベース接続エラー' });
    }

    try {
        console.log('Checking existing user...');
        // 既存ユーザーチェック
        const { data: existingUser, error: checkError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error('User check error:', checkError);
            return res.status(500).json({ error: 'ユーザー確認エラー', details: checkError.message });
        }

        if (existingUser) {
            console.log('User already exists');
            return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
        }

        console.log('Hashing password...');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        console.log('Creating user...');
        const { data: user, error } = await supabase
            .from('users')
            .insert([
                {
                    nickname,
                    email,
                    phone,
                    password_hash: hashedPassword
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('User creation error:', error);
            return res.status(500).json({ 
                error: 'ユーザー作成エラー', 
                details: error.message,
                code: error.code 
            });
        }

        console.log('User created successfully:', user.id);

        // リマインダー設定のデフォルト値を作成
        try {
            await supabase
                .from('reminder_settings')
                .insert([{ user_id: user.id }]);
        } catch (reminderError) {
            console.warn('Reminder settings creation failed:', reminderError);
            // リマインダー設定は必須ではないので続行
        }

        const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '24h' });

        res.status(201).json({
            message: 'ユーザーが作成されました',
            token,
            user: { 
                id: user.id, 
                nickname: user.nickname, 
                email: user.email, 
                phone: user.phone 
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ 
            error: 'サーバーエラー', 
            details: error.message 
        });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'メールアドレスとパスワードが必要です' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
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
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

// ファンクラブAPI
app.get('/api/fanclubs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('fanclubs')
            .select(`
                *,
                users!fanclubs_owner_id_fkey(nickname)
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Fanclubs fetch error:', error);
            return res.status(500).json({ error: 'データベースエラー' });
        }

        const fanclubs = data.map(fanclub => ({
            ...fanclub,
            owner_name: fanclub.users.nickname
        }));

        res.json(fanclubs);
    } catch (error) {
        console.error('Fanclubs fetch error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.get('/api/fanclubs/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: '検索クエリが必要です' });
    }

    try {
        const { data, error } = await supabase
            .from('fanclubs')
            .select(`
                *,
                users!fanclubs_owner_id_fkey(nickname)
            `)
            .or(`name.ilike.%${q}%,description.ilike.%${q}%,purpose.ilike.%${q}%`)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Search error:', error);
            return res.status(500).json({ error: 'データベースエラー' });
        }

        const fanclubs = data.map(fanclub => ({
            ...fanclub,
            owner_name: fanclub.users.nickname
        }));

        res.json(fanclubs);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.get('/api/fanclubs/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('fanclubs')
            .select(`
                *,
                users!fanclubs_owner_id_fkey(nickname)
            `)
            .eq('id', req.params.id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'ファンクラブが見つかりません' });
        }

        res.json({
            ...data,
            owner_name: data.users.nickname
        });
    } catch (error) {
        console.error('Fanclub fetch error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.post('/api/fanclubs', authenticateToken, async (req, res) => {
    const { name, description, monthly_fee, purpose, cover_image_url } = req.body;

    if (!name || !purpose) {
        return res.status(400).json({ error: '必須項目が不足しています' });
    }

    try {
        const { data: fanclub, error } = await supabase
            .from('fanclubs')
            .insert([
                {
                    name,
                    description,
                    monthly_fee: monthly_fee || 0,
                    purpose,
                    cover_image_url,
                    owner_id: req.user.id
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Fanclub creation error:', error);
            return res.status(500).json({ error: 'ファンクラブ作成エラー' });
        }

        // オーナーをメンバーとして追加
        await supabase
            .from('memberships')
            .insert([
                {
                    user_id: req.user.id,
                    fanclub_id: fanclub.id,
                    is_owner: true
                }
            ]);

        res.status(201).json({
            message: 'ファンクラブが作成されました',
            id: fanclub.id
        });
    } catch (error) {
        console.error('Fanclub creation error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

// メンバーシップAPI
app.post('/api/fanclubs/:id/join', authenticateToken, async (req, res) => {
    const fanclubId = req.params.id;
    const userId = req.user.id;

    try {
        // 既にメンバーかチェック
        const { data: existing } = await supabase
            .from('memberships')
            .select('id')
            .eq('user_id', userId)
            .eq('fanclub_id', fanclubId)
            .single();

        if (existing) {
            return res.status(400).json({ error: '既にこのファンクラブのメンバーです' });
        }

        // メンバーシップを作成
        const nextPaymentDate = new Date();
        nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

        const { error: membershipError } = await supabase
            .from('memberships')
            .insert([
                {
                    user_id: userId,
                    fanclub_id: fanclubId,
                    next_payment_date: nextPaymentDate.toISOString()
                }
            ]);

        if (membershipError) {
            return res.status(500).json({ error: 'メンバーシップ作成エラー' });
        }

        // ファンクラブのメンバー数を更新
        const { error: updateError } = await supabase.rpc('increment_member_count', {
            fanclub_id: fanclubId
        });

        if (updateError) {
            console.error('Member count update error:', updateError);
        }

        res.json({ message: 'ファンクラブに参加しました' });
    } catch (error) {
        console.error('Join fanclub error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.delete('/api/fanclubs/:id/leave', authenticateToken, async (req, res) => {
    const fanclubId = req.params.id;
    const userId = req.user.id;

    try {
        const { error } = await supabase
            .from('memberships')
            .delete()
            .eq('user_id', userId)
            .eq('fanclub_id', fanclubId)
            .eq('is_owner', false);

        if (error) {
            return res.status(500).json({ error: 'データベースエラー' });
        }

        // ファンクラブのメンバー数を更新
        const { error: updateError } = await supabase.rpc('decrement_member_count', {
            fanclub_id: fanclubId
        });

        if (updateError) {
            console.error('Member count update error:', updateError);
        }

        res.json({ message: 'ファンクラブから退会しました' });
    } catch (error) {
        console.error('Leave fanclub error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

// 投稿API
app.get('/api/fanclubs/:id/posts', async (req, res) => {
    const fanclubId = req.params.id;
    const userId = req.query.user_id;

    try {
        let query = supabase
            .from('posts')
            .select(`
                *,
                users!posts_author_id_fkey(nickname, avatar_url)
            `)
            .eq('fanclub_id', fanclubId);

        if (userId) {
            // ユーザーがメンバーかチェック
            const { data: membership } = await supabase
                .from('memberships')
                .select('id')
                .eq('user_id', userId)
                .eq('fanclub_id', fanclubId)
                .single();

            if (membership) {
                // メンバーなので全ての投稿を表示
                query = query.in('visibility', ['public', 'members']);
            } else {
                // 非メンバーなので公開投稿のみ
                query = query.eq('visibility', 'public');
            }
        } else {
            // ユーザーIDなしなので公開投稿のみ
            query = query.eq('visibility', 'public');
        }

        const { data, error } = await query.order('published_at', { ascending: false });

        if (error) {
            console.error('Posts fetch error:', error);
            return res.status(500).json({ error: 'データベースエラー' });
        }

        const posts = data.map(post => ({
            ...post,
            author_name: post.users.nickname,
            author_avatar: post.users.avatar_url
        }));

        res.json(posts);
    } catch (error) {
        console.error('Posts fetch error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.post('/api/fanclubs/:id/posts', authenticateToken, async (req, res) => {
    const { title, content, excerpt, featured_image_url, visibility } = req.body;
    const fanclubId = req.params.id;

    if (!title || !content) {
        return res.status(400).json({ error: 'タイトルと内容が必要です' });
    }

    try {
        // オーナーかチェック
        const { data: membership } = await supabase
            .from('memberships')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('fanclub_id', fanclubId)
            .eq('is_owner', true)
            .single();

        if (!membership) {
            return res.status(403).json({ error: '投稿権限がありません' });
        }

        const { data: post, error } = await supabase
            .from('posts')
            .insert([
                {
                    fanclub_id: fanclubId,
                    author_id: req.user.id,
                    title,
                    content,
                    excerpt,
                    featured_image_url,
                    visibility: visibility || 'public'
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Post creation error:', error);
            return res.status(500).json({ error: '投稿作成エラー' });
        }

        res.status(201).json({
            message: '投稿が作成されました',
            id: post.id
        });
    } catch (error) {
        console.error('Post creation error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

// 画像アップロードAPI
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '画像ファイルが必要です' });
    }

    res.json({
        message: '画像がアップロードされました',
        url: req.file.path
    });
});

// ユーザー情報API
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, nickname, email, phone, avatar_url, created_at')
            .eq('id', req.user.id)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        res.json(user);
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
    const { nickname, email, phone, avatar_url } = req.body;

    try {
        const { error } = await supabase
            .from('users')
            .update({
                nickname,
                email,
                phone,
                avatar_url,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.user.id);

        if (error) {
            console.error('Profile update error:', error);
            return res.status(500).json({ error: 'プロフィール更新エラー' });
        }

        res.json({ message: 'プロフィールが更新されました' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'サーバーエラー' });
    }
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
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'サーバーエラー' });
});

// 404エラー
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'APIエンドポイントが見つかりません' });
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Vercel用エクスポート
module.exports = app;

// ローカル環境での実行
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
