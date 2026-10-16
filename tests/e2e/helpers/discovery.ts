/**
 * The Playwright server's JWORD_OWNER_USER_ID (decision 027). Tests run one at a time, so the
 * default fixture user is created with this id to get discovery features; `discovery: false`
 * users get a random id and see only the public tracker.
 */
export const E2E_DISCOVERY_USER_ID = "00000000-0000-4000-8000-00000000d15c";
