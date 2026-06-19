-- Allow admins to delete import data
CREATE POLICY files_delete ON uploaded_files FOR DELETE USING (is_admin());
CREATE POLICY batches_delete ON import_batches FOR DELETE USING (is_admin());
CREATE POLICY raw_delete ON raw_import_rows FOR DELETE USING (is_admin());
CREATE POLICY schedule_delete ON schedule_records FOR DELETE USING (is_admin());
CREATE POLICY safety_delete ON safety_records FOR DELETE USING (is_admin());
CREATE POLICY rework_delete ON rework_records FOR DELETE USING (is_admin());
