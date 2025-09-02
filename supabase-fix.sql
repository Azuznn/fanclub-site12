-- RLSを一時的に無効化してテスト（開発用）
-- 本番環境では適切なRLSポリシーを設定してください

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can view all users" ON users;
DROP POLICY IF EXISTS "Fanclubs are viewable by everyone" ON fanclubs;
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON posts;
DROP POLICY IF EXISTS "Memberships are viewable by everyone" ON memberships;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Fanclub owners can manage fanclubs" ON fanclubs;
DROP POLICY IF EXISTS "Authenticated users can create fanclubs" ON fanclubs;
DROP POLICY IF EXISTS "Users can manage own memberships" ON memberships;
DROP POLICY IF EXISTS "Fanclub owners can manage posts" ON posts;
DROP POLICY IF EXISTS "Authenticated users can like" ON likes;
DROP POLICY IF EXISTS "Authenticated users can comment" ON comments;
DROP POLICY IF EXISTS "Users can manage own reminder settings" ON reminder_settings;

-- RLSを無効化（開発テスト用）
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE fanclubs DISABLE ROW LEVEL SECURITY;
ALTER TABLE memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE likes DISABLE ROW LEVEL SECURITY;
ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_settings DISABLE ROW LEVEL SECURITY;

-- テスト用: 全テーブルへのアクセスを許可
GRANT ALL ON users TO anon;
GRANT ALL ON fanclubs TO anon;
GRANT ALL ON memberships TO anon;
GRANT ALL ON posts TO anon;
GRANT ALL ON likes TO anon;
GRANT ALL ON comments TO anon;
GRANT ALL ON reminder_settings TO anon;

-- シーケンスへのアクセス許可
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- 関数の実行権限
GRANT EXECUTE ON FUNCTION increment_member_count TO anon;
GRANT EXECUTE ON FUNCTION decrement_member_count TO anon;