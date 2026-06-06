DROP POLICY IF EXISTS "Public Access vehicle-images" ON storage.objects;
CREATE POLICY "Public Access vehicle-images"
ON storage.objects FOR SELECT
USING (bucket_id = 'vehicle-images');