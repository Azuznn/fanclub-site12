-- ファンクラブサイト用Supabaseスキーマ
-- Supabase SQLエディタで実行してください

-- Users テーブル
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nickname TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fanclubs テーブル
CREATE TABLE fanclubs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    monthly_fee INTEGER NOT NULL DEFAULT 0,
    purpose TEXT,
    cover_image_url TEXT,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Memberships テーブル
CREATE TABLE memberships (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fanclub_id UUID NOT NULL REFERENCES fanclubs(id) ON DELETE CASCADE,
    is_owner BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    next_payment_date TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, fanclub_id)
);

-- Posts テーブル
CREATE TABLE posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fanclub_id UUID NOT NULL REFERENCES fanclubs(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    featured_image_url TEXT,
    visibility TEXT CHECK(visibility IN ('public', 'members')) DEFAULT 'public',
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Likes テーブル
CREATE TABLE likes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, post_id)
);

-- Comments テーブル
CREATE TABLE comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reminder Settings テーブル
CREATE TABLE reminder_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN DEFAULT TRUE,
    days_before INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- インデックスの作成
CREATE INDEX idx_fanclubs_owner_id ON fanclubs(owner_id);
CREATE INDEX idx_memberships_user_id ON memberships(user_id);
CREATE INDEX idx_memberships_fanclub_id ON memberships(fanclub_id);
CREATE INDEX idx_posts_fanclub_id ON posts(fanclub_id);
CREATE INDEX idx_posts_author_id ON posts(author_id);
CREATE INDEX idx_posts_published_at ON posts(published_at DESC);
CREATE INDEX idx_likes_post_id ON likes(post_id);
CREATE INDEX idx_comments_post_id ON comments(post_id);

-- 更新時刻の自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fanclubs_updated_at BEFORE UPDATE ON fanclubs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reminder_settings_updated_at BEFORE UPDATE ON reminder_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- メンバー数を増減する関数
CREATE OR REPLACE FUNCTION increment_member_count(fanclub_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE fanclubs 
    SET member_count = member_count + 1,
        updated_at = NOW()
    WHERE id = fanclub_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_member_count(fanclub_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE fanclubs 
    SET member_count = GREATEST(member_count - 1, 0),
        updated_at = NOW()
    WHERE id = fanclub_id;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) ポリシーの設定
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanclubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_settings ENABLE ROW LEVEL SECURITY;

-- 基本的なRLSポリシー（必要に応じて調整）
-- 全ユーザーが読み取り可能
CREATE POLICY "Users can view all users" ON users FOR SELECT USING (true);
CREATE POLICY "Fanclubs are viewable by everyone" ON fanclubs FOR SELECT USING (true);
CREATE POLICY "Posts are viewable by everyone" ON posts FOR SELECT USING (true);
CREATE POLICY "Memberships are viewable by everyone" ON memberships FOR SELECT USING (true);

-- ユーザーは自分のデータのみ更新可能
CREATE POLICY "Users can update own profile" ON users 
    FOR UPDATE USING (auth.uid() = id);

-- ファンクラブオーナーは自分のファンクラブを管理可能
CREATE POLICY "Fanclub owners can manage fanclubs" ON fanclubs 
    FOR ALL USING (auth.uid() = owner_id);

-- 認証されたユーザーはファンクラブを作成可能
CREATE POLICY "Authenticated users can create fanclubs" ON fanclubs 
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- メンバーシップの管理
CREATE POLICY "Users can manage own memberships" ON memberships 
    FOR ALL USING (auth.uid() = user_id);

-- 投稿の管理
CREATE POLICY "Fanclub owners can manage posts" ON posts 
    FOR ALL USING (
        auth.uid() IN (
            SELECT owner_id FROM fanclubs WHERE id = fanclub_id
        )
    );

-- いいねとコメントは認証されたユーザーのみ
CREATE POLICY "Authenticated users can like" ON likes 
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can comment" ON comments 
    FOR ALL USING (auth.uid() = author_id);

-- リマインダー設定は自分のもののみ
CREATE POLICY "Users can manage own reminder settings" ON reminder_settings 
    FOR ALL USING (auth.uid() = user_id);