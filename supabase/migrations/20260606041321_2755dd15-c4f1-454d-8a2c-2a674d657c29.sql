CREATE POLICY "Public read vehicle-images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'vehicle-images');