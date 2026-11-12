# Marketing homepage design

The current editable source is `interlock.pen`, under **Interlock / Marketing homepage** (`fkMcK`). Access the encrypted Pen file through Pencil MCP only. Earlier marketing explorations, including their mobile composition and shared narrative component, have been removed.

## Artifact map

| Composition     | Pen ID  | Dimensions  |
| --------------- | ------- | ----------- |
| Marketing board | `fkMcK` | 1990 × 5782 |
| Desktop         | `pi74Q` | 1440 × 4760 |
| Mobile          | `oZ9cz` | 390 × 5566  |

| Section, in page order        | Desktop ID                  | Mobile ID |
| ----------------------------- | --------------------------- | --------- |
| Hero                          | Opening children of `pi74Q` | `RcSvc`   |
| Install Interlock             | `o8xc8k`                    | `y2nVM`   |
| Build your workflow           | `Owx0c`                     | `fiCpp`   |
| Bring your own agent          | `KH5xB`                     | `X1rzl6`  |
| Run on demand or autonomously | `lHo4K`                     | `mniej`   |
| Inspect your runs             | `xjoL4`                     | `S5giq`   |
| Free, local, and open source  | `PpxPT`                     | `V7Ecut`  |
| Footer                        | `PoO96`                     | `o4qy7q`  |

## Direction

This Persuade page extends the approved Interlock Grid application language. Keep the direct writing, dark solid backgrounds, IBM Plex Sans and Mono, blue and orchid logo, selective elevation, and full-width 1px dividers. The application reference is [packages/ui/DESIGN.md](../packages/ui/DESIGN.md), with component guidance in [design-system.md](design-system.md).

Headings and descriptions always stack vertically. Navigation contains Docs, GitHub, and an Install jump link. Docs opens the documentation site at `/interlock/docs/`. The hero has no duplicate actions. Install is the first content section. Preserve the approved copy in the Pen layers.

Solid backgrounds distinguish structure, forms, and inset code. Buttons and workflow nodes retain their gradient elevation. The hero and closing use `#1A1A1A`, main content `#151515`, inset canvases `#121212`, and form cards `#212121`. Dividers are `#333333` and extend to the edges of their containers.

The implemented hero extends this direction with a static, mostly gray gradient sweep, restrained blue and orchid accents, and fine monochrome grain. A precomposed PNG background combines the curves, fade, and non-repeating grain before export, with dithering applied before final color quantization. CSS selects standard or Retina resolution. Regenerate both assets with `node scripts/generate-marketing-hero.mjs`. The headline scales to 80px on desktop and 44px on mobile. The same background extends behind the transparent navigation, with the hero reserving space for its height. The workflow preview uses a `0px 5px 25px rgba(0, 0, 0, 0.3)` outer shadow. The hero has no separate caption, and the diagram omits the separate loop annotation. Its Example marker and accessible graph description retain the illustrative context. Other text, workflow animation, and node-canvas dots are preserved. The rest of the page retains the approved Grid treatments.

## Figures

- The hero shows Entry → Build → Review → Issues found? Yes returns to Build. No continues through Open PR to Exit. Handles remain on the left and right edges. Desktop figure `m9ECBA`; mobile figure `mbKtB`.
- Build your workflow uses a simple node strip reading Your → Process → Every → Time. Types are Script, Agent, Batch, and Workflow. Desktop figure `y2s1Y3`; mobile figure `tdtwP`. This is an illustration of building blocks rather than a runnable procedure.
- Bring your own agent distinguishes automatic execution through Claude Code, Codex, Pi, or a custom harness from an existing MCP-connected agent session. Desktop figure `I5tbzY`; mobile figure `B9BtUo`. Keep the figure simple.
- The automation examples show weekday repository review at 09:00 America/Denver, skipping overlaps, and a failure follow-up workflow. Keep the local-engine requirement and illustrative disclosure.
- The report shows agent work, human wait, engine steps, and reported usage and cost. Desktop figure `cuigk`; mobile figure `O9iMI`. Keep measurement qualifications. There is no workflow-comparison link.

Examples are illustrations, not benchmarks or actual run screenshots. Webhooks are planned and are not presented as an available capability.

## Closing and footer

The closing heading is **Free, local, and open source**. All text below it uses the regular body style:

> Interlock runs on your machine. Your workflows and run history are stored locally, under your control.
>
> If you run into any problems, [open an issue on GitHub](https://github.com/dgca/interlock/issues/new).

The second paragraph links to GitHub's new-issue form. There are no install commands or separate license line in this section. The desktop bottom spacing is 87px, balanced with 88px above the heading. This wording does not claim that chosen model providers receive no task data.

The footer retains the logo and Interlock name, followed by:

MIT licensed • [github.com/dgca/interlock](https://github.com/dgca/interlock) • By [Dan Cortes](https://app.ens.domains/typeof.eth)

There is no separate footer navigation.

## Mobile adaptation

The mobile composition preserves desktop content and section order. The hero and four-node strip reflow into two columns with explicit side connections. Automation cards stack. Report timing and usage stack vertically. Install commands remain readable with a separate Copy action. Navigation and actionable footer links have 44px touch areas.

Mobile uses 17px body copy, 32px section headings, a 44px hero heading, and a 40px closing heading. Body text in the closing uses the same regular mobile body style. Figures use smaller UI text where appropriate.

## Implementation and verification

Implement in the existing static marketing site, currently `site/index.html`. The application is a visual reference, not a requirement to move the site into the application runtime. Replace the Pokémon demo with the new illustrative workflow. Preserve usable installation navigation, command copying, and external links. Validate responsive widths between the two reference compositions.

The Pen work was reviewed by section. Static checks found no unexpected clipping, verified copy parity between desktop and mobile, and checked references before deleting the old concepts. Intentional node handles extend beyond node bodies. Static designs do not verify browser interactions, keyboard behavior, real touch, or intermediate viewport layouts. No website implementation or deployment was performed.

Capability references include [managed execution](../docs/managed-executors.md), [harness connections](../docs/connect-harness.md), [Automations](../docs/automations.md), [usage reporting](../docs/usage-reporting.md), and [README](../README.md). Installation is `npm install -g @type_of/interlock`, followed by `interlock`, with Node.js 24.13 or later on macOS or Linux. Revalidate release-sensitive claims before publication.
