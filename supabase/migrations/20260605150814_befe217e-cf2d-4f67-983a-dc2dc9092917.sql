
CREATE POLICY "Public read vehicle photos"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'vehicle-photos');

CREATE POLICY "Service role manages vehicle photos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'vehicle-photos')
WITH CHECK (bucket_id = 'vehicle-photos');
