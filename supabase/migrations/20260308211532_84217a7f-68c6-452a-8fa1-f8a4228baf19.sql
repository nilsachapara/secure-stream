
-- Allow anonymous (not logged in) users to view public files
CREATE POLICY "Anyone can view public files"
ON public.files FOR SELECT TO anon
USING (is_private = false);
