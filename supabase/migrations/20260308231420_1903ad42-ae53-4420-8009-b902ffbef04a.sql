-- Drop broken restrictive policies
DROP POLICY IF EXISTS "Anyone can view public files" ON public.files;
DROP POLICY IF EXISTS "Authenticated users can view public files" ON public.files;
DROP POLICY IF EXISTS "Allowed users can view private files" ON public.files;
DROP POLICY IF EXISTS "Admins can manage files" ON public.files;

-- Recreate as PERMISSIVE (default)
CREATE POLICY "Anyone can view public files"
  ON public.files FOR SELECT
  USING (is_private = false);

CREATE POLICY "Allowed users can view private files"
  ON public.files FOR SELECT
  TO authenticated
  USING (is_private = true AND (auth.uid() = ANY(allowed_users) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Admins can manage files"
  ON public.files FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));