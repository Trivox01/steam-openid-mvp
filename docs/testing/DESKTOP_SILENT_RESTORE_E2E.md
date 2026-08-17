# Desktop silent restore E2E

This runbook keeps silent restore separate from account-changing actions.

## Clean baseline

1. Confirm there is no active test family and no local desktop credential.
2. Launch the designated functional E2E executable manually from Explorer.
3. Complete one fresh Steam login.
4. Record generation 0, one active leaf, and the Credential Manager target as present.

## Hard close and reopen

1. Quit Achievement Nexus completely, including the system tray, without logging out.
2. Confirm the process ended, the credential remains, and generation remains 0.
3. Reopen the same executable manually from Explorer.
4. Do not use Logout, Change Account, Sign In, or any authentication action during this scenario.

Expected result:

- Steam Browser opened: NO
- Login required: NO
- Authenticated UI restored: YES
- one boot initialization
- one boot restore
- one desktop refresh
- zero logout events
- zero `change_account` events
- database transition: generation 0 -> 1 ONLY
- generation 1 active, generation 2 absent, one active leaf, and no family revocation

If `desktop_logout_started`, `change_account`, or any new sign-in occurs, stop and report:

`TEST INVALIDATED BY USER ACCOUNT ACTION`

Do not classify that run as double restore. Only two actual refresh operations during the reopen qualify as:

`DOUBLE RESTORE REPRODUCED`
