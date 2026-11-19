# Mental Check-In

A client-side personal tracking app for subjective clarity, visual reaction time, symbol matching, pattern recall, and focus. The four scored activities take 3 minutes 30 seconds in total, plus transitions and optional practice.

## Development

Use Node.js 24 or newer. Run these commands from this folder.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The Vite preview serves the app alone. To preview it alongside the personal site, build it as above, then run these commands from the repository root.

```sh
quarto render .
mkdir -p _site/cognitive-test
cp -R cognitive-test/dist/. _site/cognitive-test/
python3 -m http.server --directory _site
```

Open the navbar link from the site homepage. GitHub Actions runs the app tests and build, renders Quarto, adds the app to the existing Pages artifact, and deploys on pushes to `main` or manual runs. The Pages source is GitHub Actions. Relative links support both the domain root and repository subpaths.

## Data and interpretation

Assessments stay in this browser's site storage. Private browsing, clearing site data, changing browsers or devices, and changing site origin can affect access to your history. The app has no runtime dependencies, external fonts, analytics, or service calls. JSON includes raw measurements and setup metadata. History CSV includes summary columns. The setup ID is random and stored locally. Downloads and clipboard exports contain personal results.

The one-minute reaction-time task adapts inter-stimulus timing from the three-minute brief PVT studied by [Basner et al.](https://www.med.upenn.edu/uep/assets/user-content/documents/Basner2011-ValidityandsensitivityofabriefPVT.pdf). The app retains 355 ms as a descriptive tracking cutoff. The shorter duration gives fewer opportunities to observe slow responses. Version 2 scores are plotted separately from the original three-minute version. The first stimulus follows a random 1–4 second wait. Later stimuli follow 1–4 seconds after the preceding outcome, including one second of feedback. Inputs during feedback are ignored. Thirty-second timeouts count as lapses and contribute a capped 30,000 ms sample to the reaction-time statistics. The 90th percentile is linearly interpolated.

The 90-second symbol-matching task shows the next SDMT-style prompt on the first available rendering frame after an answer. Pattern Recall uses 30 seconds of forward spatial recall, starting with three tiles per sequence. Correct sequences raise the level by one and mistakes lower it by one within the range of three to eight tiles. The longest sequence counts only if it was repeated correctly in full. Arrow Focus uses 30 seconds of flanker trials with randomized blocks containing each combination of center direction and distractor condition. Distraction cost is the median correct response time with conflicting arrows minus the median with matching arrows. Timeouts count toward accuracy, and distraction cost is blank if either condition has no correct responses. The trial counts show how much data went into these short scores. Open trials at the deadline are kept as truncated where applicable.

Use scores for personal tracking. Browser timing cannot measure the exact hardware display or input latency. Compare results collected with the same browser, device, and input method. The app can detect several signs of suspension, including loss of visibility or focus and a gap in timing callbacks. It starts every timed run with an invalid marker so that an abrupt exit cannot produce a valid score. SDMT-style scores can improve with practice. The app has no clinical validation or diagnostic use.
