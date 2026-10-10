-- Business-owned output authority, independent of job ID and queue incarnation.
CREATE TABLE core.image_fixture_outputs (
  business_request_id varchar(64) NOT NULL,
  transform_version integer NOT NULL,
  output_reference varchar(128) NOT NULL,
  PRIMARY KEY (business_request_id, transform_version)
);
