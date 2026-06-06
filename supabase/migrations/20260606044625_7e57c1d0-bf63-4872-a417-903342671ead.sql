CREATE POLICY "No direct user access to vehicle image blobs"
ON public.vehicle_images_blob
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);