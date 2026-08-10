BEGIN;

DELETE FROM public.web3_auth_challenges
WHERE address_normalized IN (
  lower('0x98afC1dd5D5e0e0ea5F7756A33Fd88aABc5fb823'),
  lower('0x663d78803d327f6d357E52E80452A85c1De97ac2'),
  lower('0x2309195A4Be2d47C682eA2dd45D6A2f65ce8EE00'),
  lower('0xb96a170a6C502399740DFaa7AF49F98D0F22F69d')
);

DELETE FROM public.web3_users
WHERE user_id IN (
  'cc3ea859-d2e9-4b63-944d-60bcc3e489d9',
  'f3ce9335-a9f8-45d9-8c2e-bb7ecd4c4776',
  'a26118dd-7891-4e6b-b10c-61346131d941',
  '9380bfdd-6d3d-4075-9e87-9490ecca01d8'
);

COMMIT;

SELECT count(*) AS remaining_canary_users
FROM public.web3_users
WHERE user_id IN (
  'cc3ea859-d2e9-4b63-944d-60bcc3e489d9',
  'f3ce9335-a9f8-45d9-8c2e-bb7ecd4c4776',
  'a26118dd-7891-4e6b-b10c-61346131d941',
  '9380bfdd-6d3d-4075-9e87-9490ecca01d8'
);
