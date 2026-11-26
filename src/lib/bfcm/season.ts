// BFCM runs once a year. Off-season it is paused, not removed: contracts,
// evergreen and approved-file downloads share this code, and next year's
// season reuses all of it.
//
// While closed:
//   - client links (/portal/bfcm/…, /review/bfcm/…) show a "season has wrapped"
//     page instead of the planner and calibration, so old bookmarks stop pulling
//     reference videos and full-size creatives from Storage;
//   - the "BFCM Creatives" sidebar link is hidden (the pages still open by URL);
//   - the home dashboard skips BFCM tasks.
// Every plan, file, task and contract stays in the database untouched.
//
// To reopen for next season, set this to true.
export const BFCM_SEASON_OPEN = false
