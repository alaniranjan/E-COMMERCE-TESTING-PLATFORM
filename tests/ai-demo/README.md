# AI demo: controlled failures

These tests fail on purpose so the AI failure analyzer (Phase 7) can be demonstrated and measured.
They are excluded from normal runs and only run when requested:

```bash
npm run test:ai-demo      # run the demo failures, then analyze them with the configured model
```

| Test | How it fails | Real cause (ground truth) |
|---|---|---|
| AI-DEMO-001 | Backpack price: expected 39.99, shop shows 29.99 | `test-data/ai-demo.json` holds a wrong expected price → TEST_DATA_DEFECT |
| AI-DEMO-002 | Waits for "Thank you for your order!", page stays on "Checkout: Overview" | The test never clicks Finish → TEST_SCRIPT_DEFECT |
| AI-DEMO-003 | POST /api/orders returns 500 instead of 201 | A simulated server outage (fixture `simulatedOrderServiceOutage` makes the mock API return 500) → APPLICATION_DEFECT |
| AI-DEMO-004 | Click on `getByTestId('chekout')` times out | Typo in the selector; the button is `data-test="checkout"` → TEST_SCRIPT_DEFECT |

The expected answers are also in `ai/eval/demo-ground-truth.json`, outside the test file, because the analyzer
includes the failing test's source code in its evidence and must not see the answer.
