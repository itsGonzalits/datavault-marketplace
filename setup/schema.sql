-- Supabase PostgreSQL Schema for DataVault

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- TABLES
-- ==========================================

-- Profiles Table
CREATE TABLE profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT CHECK (role IN ('seller', 'buyer', 'both')) DEFAULT 'buyer',
    business_name TEXT,
    industry TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'US',
    verified BOOLEAN DEFAULT false,
    verification_doc_url TEXT,
    stripe_connect_id TEXT,
    paypal_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Datasets Table
CREATE TABLE datasets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    seller_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    location TEXT,
    country TEXT,
    file_url TEXT,
    encryption_key TEXT,
    row_count INT,
    date_range_start DATE,
    date_range_end DATE,
    starting_bid NUMERIC(10,2) NOT NULL,
    reserve_price NUMERIC(10,2),
    current_top_bid NUMERIC(10,2) DEFAULT 0,
    bid_count INT DEFAULT 0,
    auction_end TIMESTAMPTZ NOT NULL,
    status TEXT CHECK (status IN ('pending', 'active', 'sold', 'expired', 'cancelled')) DEFAULT 'active',
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bids Table
CREATE TABLE bids (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
    buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL,
    payment_intent_id TEXT,
    status TEXT CHECK (status IN ('active', 'won', 'lost', 'cancelled')) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions Table
CREATE TABLE transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dataset_id UUID REFERENCES datasets(id),
    bid_id UUID REFERENCES bids(id),
    buyer_id UUID REFERENCES profiles(id),
    seller_id UUID REFERENCES profiles(id),
    amount NUMERIC(10,2) NOT NULL,
    platform_fee NUMERIC(10,2),
    seller_payout NUMERIC(10,2),
    stripe_charge_id TEXT,
    status TEXT CHECK (status IN ('pending', 'completed', 'refunded', 'failed')) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX idx_datasets_category ON datasets(category);
CREATE INDEX idx_datasets_status ON datasets(status);
CREATE INDEX idx_bids_dataset_id ON bids(dataset_id);
CREATE INDEX idx_bids_buyer_id ON bids(buyer_id);

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Profiles: authenticated users can read all, update only own
CREATE POLICY "Profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Datasets: anyone can read active ones, sellers can insert/update/delete own
CREATE POLICY "Datasets are viewable by everyone" ON datasets FOR SELECT USING (status = 'active' OR auth.uid() = seller_id);
CREATE POLICY "Sellers can insert own datasets" ON datasets FOR INSERT WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "Sellers can update own datasets" ON datasets FOR UPDATE USING (auth.uid() = seller_id);
CREATE POLICY "Sellers can delete own datasets" ON datasets FOR DELETE USING (auth.uid() = seller_id);

-- Bids: buyers can insert own bids, sellers can read bids on their datasets, buyers can read own bids
CREATE POLICY "Buyers can view own bids" ON bids FOR SELECT USING (auth.uid() = buyer_id);
CREATE POLICY "Sellers can view bids on their datasets" ON bids FOR SELECT USING (
    EXISTS (SELECT 1 FROM datasets WHERE id = bids.dataset_id AND seller_id = auth.uid())
);
CREATE POLICY "Buyers can insert own bids" ON bids FOR INSERT WITH CHECK (auth.uid() = buyer_id);

-- Transactions: buyer/seller can each read their own
CREATE POLICY "Involved parties can view transactions" ON transactions FOR SELECT USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id
);

-- ==========================================
-- FUNCTIONS & TRIGGERS
-- ==========================================

-- Auto-create profile on sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Update dataset current top bid and bid count when a new bid is placed
CREATE OR REPLACE FUNCTION public.update_dataset_top_bid()
RETURNS trigger AS $$
BEGIN
  UPDATE datasets
  SET current_top_bid = GREATEST(current_top_bid, NEW.amount),
      bid_count = bid_count + 1
  WHERE id = NEW.dataset_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_dataset_bid
  AFTER INSERT ON bids
  FOR EACH ROW EXECUTE PROCEDURE public.update_dataset_top_bid();

-- Function to get platform stats (for homepage)
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS json AS $$
DECLARE
  total_datasets INT;
  total_paid NUMERIC;
  total_buyers INT;
BEGIN
  SELECT count(*) INTO total_datasets FROM datasets WHERE status IN ('active', 'sold');
  SELECT COALESCE(sum(amount), 0) INTO total_paid FROM transactions WHERE status = 'completed';
  SELECT count(DISTINCT buyer_id) INTO total_buyers FROM transactions;
  
  RETURN json_build_object(
    'total_datasets', total_datasets,
    'total_paid_out', total_paid,
    'total_buyers', total_buyers
  );
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- STORAGE SETUP (Comments/Notes)
-- ==========================================
/*
To setup storage buckets in Supabase:
1. 'datasets' bucket:
   - Make it Private (do not enable public sharing).
   - Add RLS policies or restrict access to Authenticated Users (Service Role can bypass RLS to generate signed URLs).
   - Set file size limits (e.g. 100MB).

2. 'verification-docs' bucket:
   - Make it Private.
   - Access only for Service Role (for backend admin validation).
*/
