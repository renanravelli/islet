# Islet — UI specification (v0.1)

| Area                  | Status                                          |
| --------------------- | ----------------------------------------------- |
| Island and its states | Approved                                        |
| Onboarding (4 steps)  | Approved — 2026-11-03                           |
| Settings window       | Designed; changes may still come before Phase 5 |
| Theming (light/dark)  | Required: follows the macOS appearance          |

The visual reference is the project's private design canvas. **This document is the source of truth for implementation.** Where the canvas and this document differ, this document wins.

---

## 1. Theming

### 1.1 Rules

1. **Windows follow the macOS appearance, live.**
   - Applies to onboarding and settings, in light and dark.
   - There is no in-app theme override in v0.1.
2. **How to implement it:**
   - Define tokens as CSS custom properties on `:root`.
   - Put dark values in `@media (prefers-color-scheme: dark)`.
   - Do not force a theme in the Tauri window config.
   - Verify that changing System Settings → Appearance updates an already-open window.
3. **No flash.** A window opened in dark mode must never flash white. Set the native window background to the current theme before the first paint.
4. **The island and the floating pill are always black, in both themes.**
   - They extend the hardware notch, so their tokens (1.3) are theme-independent.
   - Do not draw a camera dot: the mock shows one only to illustrate where the real camera sits. Fill the center region black.
5. **The tray icon is a template image**, so macOS tints it for light and dark menu bars.
6. **Contrast**, verified in both themes:
   - text ≥ 4.5:1;
   - boundaries of interactive components ≥ 3:1.
   - Disabled controls are exempt.
7. **Reduced motion.** With `prefers-reduced-motion: reduce`, transitions become instant and the spinner stops.

### 1.2 Window tokens

| Token                   | Light     | Dark      | Used for                                                      |
| ----------------------- | --------- | --------- | ------------------------------------------------------------- |
| `--bg-window`           | `#FFFFFF` | `#1C1C1E` | onboarding window                                             |
| `--bg-content`          | `#F7F7F8` | `#1C1C1E` | settings content area                                         |
| `--bg-sidebar`          | `#EFEFF2` | `#252527` | settings sidebar                                              |
| `--bg-group`            | `#FFFFFF` | `#2C2C2E` | grouped cards and rows                                        |
| `--bg-subtle`           | `#F2F2F4` | `#3A3A3C` | secondary buttons, keycaps, step badges                       |
| `--bg-preview`          | `#F5F5F7` | `#2A2A2C` | preview and illustration cards, tip boxes                     |
| `--bg-menubar`          | `#E9E9EC` | `#2C2C2E` | menu-bar strip inside preview cards                           |
| `--border`              | `#E3E3E8` | `#3A3A3C` | card borders                                                  |
| `--separator`           | `#ECECEF` | `#38383A` | row separators, footer border                                 |
| `--border-control`      | `#C7C7CC` | `#545458` | outline buttons, select                                       |
| `--dot-inactive`        | `#D1D1D6` | `#545458` | step indicator                                                |
| `--text-primary`        | `#1D1D1F` | `#F5F5F7` | headings, labels                                              |
| `--text-secondary`      | `#48484A` | `#D1D1D6` | body copy                                                     |
| `--text-tertiary`       | `#6E6E73` | `#98989D` | descriptions, captions                                        |
| `--accent-fill`         | `#0B63CE` | `#0B63CE` | primary buttons, selected nav item, switch on (white content) |
| `--accent-text`         | `#0B63CE` | `#4C9BFF` | links, text buttons                                           |
| `--success-text`        | `#1A7F37` | `#30D158` | "Pronto", "Conectada", OK                                     |
| `--success-bg`          | `#E8F5EC` | `#1E3A27` | success circles, status pill, banner                          |
| `--success-banner-text` | `#14532D` | `#B7F0C8` | connected banner text                                         |
| `--warning-bg`          | `#FFF1DC` | `#3D2A0F` | "Experimental" badge, warning pill                            |
| `--warning-text`        | `#8A4B00` | `#FFB340` | warnings, inline errors                                       |
| `--disabled-bg`         | `#E8E8ED` | `#3A3A3C` | disabled primary button                                       |
| `--disabled-text`       | `#8E8E93` | `#7C7C80` | disabled primary button                                       |
| `--switch-off-track`    | `#E9E9EB` | `#3A3A3C` | switch off                                                    |
| `--switch-off-ring`     | `#8E8E93` | `#8E8E93` | 1px inset ring on the off track                               |
| `--keycap-shadow`       | `#C7C7CC` | `#1C1C1E` | 1px bottom inset on keycaps                                   |

### 1.3 Island tokens (theme-independent)

| Token                | Value     | Used for                |
| -------------------- | --------- | ----------------------- |
| `--island-bg`        | `#000000` | island, pill            |
| `--island-text`      | `#FFFFFF` | primary text, icons     |
| `--island-text-2`    | `#A1A1A6` | meeting title, labels   |
| `--island-control`   | `#2C2C2E` | control buttons         |
| `--island-speaking`  | `#32D74B` | speaker ring, waveform  |
| `--island-danger`    | `#FF453A` | mic off icon, Leave     |
| `--island-attention` | `#FF9F0A` | alert glow, hand raised |
| `--island-primary`   | `#0B63CE` | primary action          |

### 1.4 Typography

- **Font:** the system font (SF Pro), with `-apple-system, BlinkMacSystemFont` first in the stack.
- **Numbers:** timers use tabular numerals.

---

## 2. Shared components

| Component        | Spec                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary button   | Height 44, padding `0 22`, radius 10, `--accent-fill`, white 14/600                                                                                                                                                                                      |
| Secondary button | Height 44, padding `0 18`, radius 10, `--bg-subtle`, `--text-primary` 14/600                                                                                                                                                                             |
| Outline button   | Height 44, padding `0 14`, radius 9, 1px `--border-control`, `--bg-group`, 13/500                                                                                                                                                                        |
| Text button      | Height 44, padding `0 10`, `--accent-text` 13/500, no background                                                                                                                                                                                         |
| Disabled primary | Real `disabled` attribute, `--disabled-bg` / `--disabled-text`                                                                                                                                                                                           |
| Switch           | `<button role="switch" aria-checked>`; hit area 56×44; track 42×26 radius 13; knob 22 white with a soft shadow. On: track `--accent-fill`, knob at left 18. Off: `--switch-off-track` + 1px inset `--switch-off-ring`, knob at left 2. 150 ms transition |
| Keycap           | `<kbd>`, min 26×26, padding `0 6`, radius 6, `--bg-subtle`, inset bottom 1px `--keycap-shadow` + 1px ring `--border`, 13/600                                                                                                                             |
| Group            | Radius 10, 1px `--border`, `--bg-group`. Rows separated by 1px `--separator`; min height 52 (label only) or 64 (with description); left padding 16, right 8 when the row ends in a switch. Label 14/500; description 12 `--text-tertiary`                |
| Section label    | 12/600, uppercase, letter-spacing 0.04em, `--text-tertiary`, margin `0 0 8 4`                                                                                                                                                                            |
| Status pill      | Radius 999, padding `4 10`, 12/600, 7px dot. Variants: success, warning, neutral (`--bg-subtle` / `--text-secondary`)                                                                                                                                    |
| Badge            | Radius 6, padding `2 8`, 11/600. Experimental uses the warning colors                                                                                                                                                                                    |
| Step indicator   | Four dots, 6×6 radius 3, `--dot-inactive`; the active one is 18×6 `--text-primary`. Text "Passo N de 4" 12 `--text-tertiary`                                                                                                                             |
| Icons            | Inline stroke SVG, 2px stroke, round caps and joins. Decorative icons get `aria-hidden="true"`                                                                                                                                                           |

Every interactive element is a real `<button>`, `<a href>`, `<input>` or `<select>` with a label. Icon-only buttons have an `aria-label`.

---

## 3. Onboarding window

**Window:**
- 720×520 pt, fixed size, not resizable.
- Centered on the screen with the notch, or on the main screen if there is none.
- Native titlebar overlay with the system traffic lights and no title text. The mock reserves 40 pt at the top for it.

**Layout:**
- **Content:** padding `4 56 0`.
- **Footer:** 76 pt tall, top border `--separator`, padding `0 28`.
  - Left: the step indicator.
  - Right: the buttons, gap 10.

**When it opens:**
- **First launch:** automatically, when there is no `onboarding.completed_at` yet.
- **On demand:** from the tray ("Rever onboarding") and from Settings → Privacidade e sobre.

**Closing early:**
- Allowed.
- The tray shows "Concluir configuração…" until onboarding is completed.
- The window never reopens automatically after the first launch.

### Step 1 — Welcome

- **Mark:** black pill 40×22, radius 11, with a 6px green dot on the left, followed by the wordmark "Islet" at 15/700.
- **Title:** 26/700, line height 1.2, margin-top 24.
- **Body:** 15, line height 1.55, `--text-secondary`, max width 560.
- **Preview card:**
  - Height 124, radius 12, 1px `--border`, `--bg-preview`.
  - A 37 pt `--bg-menubar` strip across the top.
  - The real compact island, driven live by `DemoProvider`, centered at the top. Not a static image.
  - Caption at the bottom left, 12 `--text-tertiary`.
- **Privacy line:** lock icon 16 + text 13 `--text-secondary`.
- **Footer:** "Começar" (primary) goes to step 2.

### Step 2 — Connect Chrome

A group card with two rows. The row states are driven by real events, never by timers.

**Row A — Chrome bridge:**
- When the step mounts, the app runs the manifest install/repair routine (the same routine as Settings → "Reinstalar ponte do Chrome").
- **OK state:** success circle with a check; status "Pronto" in `--success-text`.
- **Error state:**
  - warning icon in a `--warning-bg` circle;
  - error summary as the description;
  - outline button "Tentar novamente".

**Row B — Islet extension:**

| State           | Leading icon                                         | Description                                         | Trailing element                                    |
| --------------- | ---------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `not_connected` | numbered badge "2" (`--bg-subtle`)                   | `onb2.ext.idle_desc`                                | primary button "Instalar extensão"                  |
| `waiting`       | 16px spinner (2px ring, `--accent-fill` top segment) | `onb2.ext.waiting_desc_store`, `_meet` or `_manual` | status text "Aguardando conexão…" (`role="status"`) |
| `connected`     | success circle with check                            | `onb2.ext.connected_desc`                           | status text "Conectada" in `--success-text`         |

**Behavior:**
- **"Instalar extensão":**
  - it opens `EXTENSION_STORE_URL`, the extension's Chrome Web Store page, and uses the `_store` description;
  - the manual "Load unpacked" guide (`docs/install-extension.md`) stays reachable through the troubleshooting link.
- **`connected`** is set only when the extension's real `hello` arrives. If the extension was already connected when the step opens, show `connected` right away.
  - Right after "Adicionar ao Chrome", the extension runs its connection test (ADR 0002): it says `hello` and closes the bridge 10 s later if no Meet tab is open. Once the `hello` arrived, the step stays `connected` while the window is open, even after the bridge closes.
  - An extension installed earlier sends nothing until a Meet tab opens. While not connected, a line below the card offers `onb2.ext.have_it` with the text button `onb2.ext.open_meet`: it opens `https://meet.google.com/` and switches the row to `waiting` with the `_meet` description.
  - The store page and Meet open in Google Chrome, whatever the default browser is (in the default browser only when Chrome is missing).
- **After 60 s in `waiting`:** show the text button "Não conectou? Ver solução de problemas", which opens the troubleshooting section of the install doc.
- **Below the card:**
  - when connected: the success banner (`--success-bg`, text `--success-banner-text`, 13);
  - when connected: the banner starts with a 16px check in `--success-text`;
  - otherwise: the "Já tem a extensão?" line (13 `--text-secondary`, hidden once Meet was opened) and the other-browsers note (12 `--text-tertiary`).

**Footer:**
- Always: "Voltar" (secondary).
- Not connected: "Pular por enquanto" (text button) and a disabled "Continuar".
- Connected: "Continuar" (primary).

### Step 3 — Meet's automatic Picture-in-Picture

- **Two columns, gap 24:**
  - **Left — the steps:** an ordered list of three steps. Each has a 26px number circle (`--accent-fill`, white 13/700) and text at 14, line height 1.45, with the UI names in bold.
  - **Right — illustration, 260 wide** (the target option fits on one line):
    - a `--bg-preview` card with the label `onb3.illustration_label`;
    - a dropdown menu (1px `--border`, radius 8, `--bg-group`, soft shadow) whose first row is **only the target option**, highlighted with `--accent-fill`, white text and a check on the right;
    - below it in the same menu, three rows with neutral placeholder bars (`--border`), split by `--separator`.
    - **Never write the text of the other options:** we can't verify Meet's exact copy.
- **Tip box:** `--bg-preview`, radius 10, info icon, 12, line height 1.5.
- **Footer:** "Voltar", "Fazer depois" (text button) and "Já desliguei" (primary).
  - Both advance to step 4.
  - "Já desliguei" stores `meet_pip_tip_ack = true`. We can't verify Meet's setting; the flag only keeps the tip from repeating.

### Step 4 — All set

- **Success circle:** 48px, check icon 24.
- **Title and body.**
- **Group card:**
  - two shortcut rows, with a 96-wide keycap column on the left (`⌃ ⌥ I` and `⌃ ⌥ M`), then the label;
  - one switch row: "Abrir o Islet ao iniciar o Mac";
  - one switch row: `updates.auto`, with `updates.auto_desc` (ADR 0006).
- **Shortcut rows:** if a shortcut failed to register, the row shows `shortcut.unavailable` in `--warning-text` instead of looking normal.
- **Launch-at-login switch:**
  - defaults to **on** in this step;
  - applies immediately through the autostart plugin;
  - on failure it reverts and shows `onb4.launch_error` in `--warning-text`.
- **Update switch:** defaults to **off** and stays off until the person turns it on; it applies
  immediately to `check_for_updates`, and turning it on checks once right away.
- **Menu-bar hint:** a mini black pill icon + text 13 `--text-secondary`.
- **Footer:** "Voltar" and "Concluir" (primary). "Concluir" closes the window and stores `onboarding.completed_at`.

---

## 4. Settings window

**Window:** 760×540 pt, fixed size in v0.1. It opens from the tray ("Configurações…") and with ⌘, while an Islet window is focused.

**Sidebar:**
- Width 208, `--bg-sidebar`, 1px right border `--border`, padding `14 10`.
- The traffic lights sit in the sidebar's top area.
- **Nav items:**
  - 44 tall, radius 8, 17px icon + label 14/500;
  - the selected item gets `--accent-fill` with white content and `aria-current="page"`.
- At the bottom: "Islet {version}" at 12 `--text-tertiary`.

**Content:**
- Header 54 tall: pane title 18/700, padding `14 28 0`.
- Scroll area: padding `6 28 24`.
- Groups are spaced 20 apart.

### Pane: Geral

- **"Abrir ao iniciar o Mac"** (switch). It reflects the real autostart state.
- **"Idioma"** (native `<select>` with a `<label>`):
  - options: Automático (sistema) · Português (Brasil) · English;
  - applies immediately to every window and to the island;
  - language names stay in their own language in both locales.
- **Section "Atalhos":**
  - two keycap rows;
  - footnote `settings.shortcuts.note`;
  - a shortcut that failed to register shows `shortcut.unavailable` in its row.

### Pane: Ilha

**Section "Comportamento":**

| Setting                      | Default | Notes                                                                                                                                                                                                                                        |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Expandir ao passar o mouse" | off     | —                                                                                                                                                                                                                                            |
| "Mostrar nomes e fotos"      | on      | Maps to the core setting `show_participant_names`. When off, the **core** strips names, photos and titles before publishing the `UiSnapshot`, so the UI never receives them. The island then shows a generic speaker avatar and the waveform |
| "Aviso de falando no mudo"   | off     | "Experimental" badge                                                                                                                                                                                                                         |

**Section "Telas sem notch":** one read-only row with a mini pill preview.

### Pane: Integrações

**Section "Disponível" — the Google Meet card:**
- **Header:** a 36px icon tile with a generic video icon on `--text-primary`. Never use Google's logo.
- **Title:** "Google Meet".
- **Subtitle:**
  - "Chrome · extensão {version}" when connected;
  - "Chrome · extensão não conectada" otherwise.
- **Status pill:**

| State                                | Pill                           |
| ------------------------------------ | ------------------------------ |
| Extension connected, adapter healthy | success: `status.connected`    |
| Extension not connected              | neutral: `status.disconnected` |
| Last session degraded                | warning: `status.degraded`     |
| Manifest missing or broken           | warning: `status.bridge_error` |

- **"Saúde do adaptador" row:**
  - OK: `health.ok_desc` and "OK";
  - degraded: `health.degraded_desc`, listing the failing selector keys in a smaller line;
  - before any call: `health.no_data_desc`.
- **Actions row (outline buttons):**
  - **"Copiar diagnóstico":** copies the core's redacted diagnostic to the clipboard and shows a transient confirmation `toast.diagnostics_copied`. The diagnostic has no names, titles or meeting codes.
  - **"Reinstalar ponte do Chrome":** runs the manifest repair routine and shows the result inline.

The pane shows only integrations that work: no planned or upcoming apps.

### Pane: Privacidade e sobre

- **Statement card:** lock icon, title and body.
- **Rows:**
  - Logs (outline button "Abrir pasta", which opens the folder in Finder);
  - Guia inicial ("Rever onboarding", which opens the onboarding window);
  - Versão;
  - Código-fonte (link, opens in the browser);
  - Licença.
- **Section "Atualizações"** (`updates.section`, ADR 0006), right below the statement card:
  - switch row `updates.auto` with `updates.auto_desc`, the same setting as onboarding step 4;
  - status row: the text for the update state (`updates.status_*`; idle shows the installed
    version) and one button: `updates.install` (primary) when a version is available,
    `updates.check_now` (outline) otherwise, disabled while checking or installing.
- **Tray:** while a version is available the menu adds `tray.update_available`, which installs
  it; while installing, a disabled `tray.updating`. The app never installs by itself.

---

## 5. Island deltas for v0.1

These complement the visual spec in the kickoff and the approved canvas:

- **Chat is hidden in v0.1.** The Meet provider does not declare a chat capability, and the UI renders only declared controls. The expanded state has five buttons: Microfone, Câmera, Levantar mão, Abrir aba, Sair.
- **`Unknown` is drawn distinctly.** Mic, camera or hand in `Unknown` uses a neutral icon in `--island-text-2` with the aria-label `island.unknown`. Never show it as "on".
- **Camera indicator (the owner's request, 2026-11-03; not in the canvas):** while the camera is `On`, the compact island and the pill show a camera icon in `--island-speaking` green in the right ear, between the raised hand and the mic, with the aria-label `island.cam`. Off or `Unknown`: no icon. When the right ear's items do not fit its 88 pt, both ears widen by the same amount, so the notch stays centered and nothing slides under it.
- **Degraded indicator:** a small `--island-attention` dot at the end of the right ear, with tooltip `island.degraded_tooltip`.
- **Names off:** when `show_participant_names` is off, there are no names, photos or initials; a generic avatar is shown.
- **Participant photos (docs/adr/0007):** an avatar with `avatar` draws that photo, cropped to the circle (`object-fit: cover`), instead of the initials, at every size (20, 24 and 44 pt); the speaking ring and the stack's outline stay as they are. Without a photo (before the first one arrives, an account without one, or a page that does not allow reading it) it draws the initials on their color, as before. A photo is always the same person's: the core gets it from the same tile as the name.

---

## 6. Strings (pt-BR / en)

All UI text comes from this dictionary. `{x}` marks an interpolation; `**…**` marks bold.

### Common

| Key                      | pt-BR                                | en                                         |
| ------------------------ | ------------------------------------ | ------------------------------------------ |
| `common.back`            | Voltar                               | Back                                       |
| `common.continue`        | Continuar                            | Continue                                   |
| `common.retry`           | Tentar novamente                     | Try again                                  |
| `onboarding.step_of`     | Passo {n} de {total}                 | Step {n} of {total}                        |
| `shortcut.toggle_island` | Expandir ou recolher a ilha          | Expand or collapse the island              |
| `shortcut.toggle_mic`    | Ligar ou desligar o microfone        | Turn the microphone on or off              |
| `shortcut.unavailable`   | Atalho indisponível: já está em uso. | Shortcut unavailable: it's already in use. |

### Onboarding

| Key                            | pt-BR                                                                                                                                                         | en                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `onb1.title`                   | Sua call no notch, não na frente do trabalho                                                                                                                  | Your call in the notch, not on top of your work                                                                                               |
| `onb1.body`                    | O Islet mostra quem está falando, o estado do seu microfone e os controles da reunião ao redor do notch. O Picture-in-Picture do Meet deixa de cobrir a tela. | Islet shows who's speaking, your mic status and meeting controls around the notch, so Meet's Picture-in-Picture no longer covers your screen. |
| `onb1.preview_caption`         | Pré-visualização em modo demo                                                                                                                                 | Demo mode preview                                                                                                                             |
| `onb1.privacy`                 | Tudo roda no seu Mac. Sem contas e sem telemetria.                                                                                                            | Everything runs on your Mac. No accounts, no telemetry.                                                                                       |
| `onb1.cta`                     | Começar                                                                                                                                                       | Get started                                                                                                                                   |
| `onb2.title`                   | Conecte o Islet ao Google Meet                                                                                                                                | Connect Islet to Google Meet                                                                                                                  |
| `onb2.body`                    | Uma extensão do Chrome lê o estado da reunião e envia os seus comandos para ela. A extensão só tem acesso a meet.google.com.                                  | A Chrome extension reads the meeting state and sends your commands to it. The extension only has access to meet.google.com.                   |
| `onb2.bridge.title`            | Ponte com o Chrome                                                                                                                                            | Chrome bridge                                                                                                                                 |
| `onb2.bridge.ok_desc`          | Instalada automaticamente pelo Islet.                                                                                                                         | Installed automatically by Islet.                                                                                                             |
| `onb2.bridge.ok`               | Pronto                                                                                                                                                        | Ready                                                                                                                                         |
| `onb2.bridge.error_desc`       | Não foi possível instalar a ponte.                                                                                                                            | Couldn't install the bridge.                                                                                                                  |
| `onb2.ext.title`               | Extensão do Islet                                                                                                                                             | Islet extension                                                                                                                               |
| `onb2.ext.idle_desc`           | Abre a página da extensão no Chrome.                                                                                                                          | Opens the extension page in Chrome.                                                                                                           |
| `onb2.ext.install`             | Instalar extensão                                                                                                                                             | Install extension                                                                                                                             |
| `onb2.ext.waiting_desc_store`  | Na página que abriu, clique em Adicionar ao Chrome. Esta tela atualiza sozinha.                                                                               | On the page that opened, click Add to Chrome. This screen updates on its own.                                                                 |
| `onb2.ext.waiting_desc_manual` | Siga as instruções que abriram no navegador. Esta tela atualiza sozinha.                                                                                      | Follow the instructions that opened in your browser. This screen updates on its own.                                                          |
| `onb2.ext.waiting_desc_meet`   | Quando o Meet abrir no Chrome, a extensão se conecta. Esta tela atualiza sozinha.                                                                             | Once Meet opens in Chrome, the extension connects. This screen updates on its own.                                                            |
| `onb2.ext.waiting`             | Aguardando conexão…                                                                                                                                           | Waiting for connection…                                                                                                                       |
| `onb2.ext.troubleshoot`        | Não conectou? Ver solução de problemas                                                                                                                        | Not connecting? See troubleshooting                                                                                                           |
| `onb2.ext.have_it`             | Já tem a extensão?                                                                                                                                            | Already have the extension?                                                                                                                   |
| `onb2.ext.open_meet`           | Abrir o Meet para testar                                                                                                                                      | Open Meet to test it                                                                                                                          |
| `onb2.ext.connected_desc`      | Versão {version} · respondeu ao teste de conexão.                                                                                                             | Version {version} · passed the connection test.                                                                                               |
| `onb2.ext.connected`           | Conectada                                                                                                                                                     | Connected                                                                                                                                     |
| `onb2.banner`                  | Tudo certo. Na próxima call do Meet, a ilha aparece sozinha.                                                                                                  | All set. Your next Meet call will appear in the island automatically.                                                                         |
| `onb2.other_browsers`          | Usa Brave, Edge ou Arc? O suporte a outros navegadores chega numa próxima versão.                                                                             | Using Brave, Edge or Arc? Support for other browsers is coming in a future release.                                                           |
| `onb2.skip`                    | Pular por enquanto                                                                                                                                            | Skip for now                                                                                                                                  |
| `onb3.title`                   | Desligue o Picture-in-Picture automático                                                                                                                      | Turn off automatic Picture-in-Picture                                                                                                         |
| `onb3.body`                    | Com a ilha no notch, a janela flutuante do Meet não é mais necessária. Desligá-la evita que ela abra toda vez que você troca de aba.                          | With the island in the notch, Meet's floating window is no longer needed. Turning it off stops it from opening every time you switch tabs.    |
| `onb3.step1`                   | Numa reunião do Meet, abra **Mais opções** e depois **Configurações**.                                                                                        | In a Meet call, open **More options**, then **Settings**.                                                                                     |
| `onb3.step2`                   | Na aba **Geral**, encontre **Picture-in-picture automático**.                                                                                                 | In the **General** tab, find **Automatic picture-in-picture**.                                                                                |
| `onb3.step3`                   | Escolha **Nunca exibir automaticamente**.                                                                                                                     | Choose **Never automatically show**.                                                                                                          |
| `onb3.illustration_label`      | Picture-in-picture automático                                                                                                                                 | Automatic picture-in-picture                                                                                                                  |
| `onb3.illustration_option`     | Nunca exibir automaticamente                                                                                                                                  | Never automatically show                                                                                                                      |
| `onb3.tip`                     | Prefere desligar no Chrome? Clique no ícone de informações do site, à esquerda do endereço, e desative **Picture-in-picture automático**.                     | Prefer to turn it off in Chrome? Click the site information icon to the left of the address and turn off **Automatic picture-in-picture**.    |
| `onb3.later`                   | Fazer depois                                                                                                                                                  | Do it later                                                                                                                                   |
| `onb3.done`                    | Já desliguei                                                                                                                                                  | I've turned it off                                                                                                                            |
| `onb4.title`                   | Tudo pronto                                                                                                                                                   | You're all set                                                                                                                                |
| `onb4.body`                    | Na próxima call do Meet, a ilha aparece sozinha ao redor do notch.                                                                                            | Your next Meet call will appear in the island around the notch.                                                                               |
| `onb4.launch`                  | Abrir o Islet ao iniciar o Mac                                                                                                                                | Open Islet when your Mac starts                                                                                                               |
| `onb4.launch_error`            | Não foi possível ativar. Tente de novo nas configurações.                                                                                                     | Couldn't turn this on. Try again in Settings.                                                                                                 |
| `onb4.menubar`                 | O Islet fica na barra de menus, com o status da conexão, as configurações e este guia.                                                                        | Islet lives in the menu bar, with connection status, settings and this guide.                                                                 |
| `onb4.finish`                  | Concluir                                                                                                                                                      | Finish                                                                                                                                        |

### Settings

| Key                                           | pt-BR                                                                                                                                                                                                                                    | en                                                                                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.window_title`                       | Configurações do Islet                                                                                                                                                                                                                   | Islet Settings                                                                                                                                                                                                                |
| `settings.nav.general`                        | Geral                                                                                                                                                                                                                                    | General                                                                                                                                                                                                                       |
| `settings.nav.island`                         | Ilha                                                                                                                                                                                                                                     | Island                                                                                                                                                                                                                        |
| `settings.nav.integrations`                   | Integrações                                                                                                                                                                                                                              | Integrations                                                                                                                                                                                                                  |
| `settings.nav.privacy`                        | Privacidade e sobre                                                                                                                                                                                                                      | Privacy & About                                                                                                                                                                                                               |
| `settings.general.launch`                     | Abrir ao iniciar o Mac                                                                                                                                                                                                                   | Open when your Mac starts                                                                                                                                                                                                     |
| `settings.general.language`                   | Idioma                                                                                                                                                                                                                                   | Language                                                                                                                                                                                                                      |
| `settings.general.language.system`            | Automático (sistema)                                                                                                                                                                                                                     | Automatic (system)                                                                                                                                                                                                            |
| `settings.shortcuts`                          | Atalhos                                                                                                                                                                                                                                  | Shortcuts                                                                                                                                                                                                                     |
| `settings.shortcuts.note`                     | Na v0.1 os atalhos são fixos. Se algum não puder ser registrado, o Islet avisa na barra de menus.                                                                                                                                        | Shortcuts are fixed in v0.1. If one can't be registered, Islet lets you know in the menu bar.                                                                                                                                 |
| `settings.island.behavior`                    | Comportamento                                                                                                                                                                                                                            | Behavior                                                                                                                                                                                                                      |
| `settings.island.hover`                       | Expandir ao passar o mouse                                                                                                                                                                                                               | Expand on hover                                                                                                                                                                                                               |
| `settings.island.hover_desc`                  | Desligado, a ilha abre com clique ou atalho.                                                                                                                                                                                             | When off, the island opens on click or shortcut.                                                                                                                                                                              |
| `settings.island.names`                       | Mostrar nomes e fotos                                                                                                                                                                                                                    | Show names and photos                                                                                                                                                                                                         |
| `settings.island.names_desc`                  | Desligado, a ilha mostra só a atividade de fala, sem nomes nem fotos.                                                                                                                                                                    | When off, the island shows speaking activity only, without names or photos.                                                                                                                                                   |
| `settings.island.muted_alert`                 | Aviso de falando no mudo                                                                                                                                                                                                                 | Speaking-while-muted alert                                                                                                                                                                                                    |
| `settings.island.muted_alert_desc`            | Depende de um aviso do próprio Meet e pode falhar após atualizações dele.                                                                                                                                                                | Relies on a notice from Meet itself and may break when Meet updates.                                                                                                                                                          |
| `settings.island.no_notch`                    | Telas sem notch                                                                                                                                                                                                                          | Screens without a notch                                                                                                                                                                                                       |
| `settings.island.no_notch_row`                | Monitor externo ou Mac sem notch                                                                                                                                                                                                         | External display or Mac without a notch                                                                                                                                                                                       |
| `settings.island.no_notch_desc`               | A ilha vira uma pílula flutuante no topo central da tela.                                                                                                                                                                                | The island becomes a floating pill at the top center of the screen.                                                                                                                                                           |
| `settings.integrations.available`             | Disponível                                                                                                                                                                                                                               | Available                                                                                                                                                                                                                     |
| `settings.integrations.meet_sub_connected`    | Chrome · extensão {version}                                                                                                                                                                                                              | Chrome · extension {version}                                                                                                                                                                                                  |
| `settings.integrations.meet_sub_disconnected` | Chrome · extensão não conectada                                                                                                                                                                                                          | Chrome · extension not connected                                                                                                                                                                                              |
| `settings.integrations.health`                | Saúde do adaptador                                                                                                                                                                                                                       | Adapter health                                                                                                                                                                                                                |
| `status.connected`                            | Conectado                                                                                                                                                                                                                                | Connected                                                                                                                                                                                                                     |
| `status.disconnected`                         | Não conectado                                                                                                                                                                                                                            | Not connected                                                                                                                                                                                                                 |
| `status.degraded`                             | Degradado                                                                                                                                                                                                                                | Degraded                                                                                                                                                                                                                      |
| `status.bridge_error`                         | Ponte com problema                                                                                                                                                                                                                       | Bridge issue                                                                                                                                                                                                                  |
| `health.ok`                                   | OK                                                                                                                                                                                                                                       | OK                                                                                                                                                                                                                            |
| `health.ok_desc`                              | Todos os elementos do Meet foram encontrados na última call.                                                                                                                                                                             | All Meet elements were found in the last call.                                                                                                                                                                                |
| `health.degraded_desc`                        | {n} elemento(s) do Meet não foram encontrados na última call.                                                                                                                                                                            | {n} Meet element(s) weren't found in the last call.                                                                                                                                                                           |
| `health.no_data_desc`                         | Sem dados ainda. Entre numa call do Meet para verificar.                                                                                                                                                                                 | No data yet. Join a Meet call to check.                                                                                                                                                                                       |
| `action.copy_diagnostics`                     | Copiar diagnóstico                                                                                                                                                                                                                       | Copy diagnostics                                                                                                                                                                                                              |
| `toast.diagnostics_copied`                    | Diagnóstico copiado, sem dados pessoais.                                                                                                                                                                                                 | Diagnostics copied, no personal data included.                                                                                                                                                                                |
| `action.reinstall_bridge`                     | Reinstalar ponte do Chrome                                                                                                                                                                                                               | Reinstall Chrome bridge                                                                                                                                                                                                       |
| `bridge.reinstalled`                          | Ponte reinstalada.                                                                                                                                                                                                                       | Bridge reinstalled.                                                                                                                                                                                                           |
| `badge.experimental`                          | Experimental                                                                                                                                                                                                                             | Experimental                                                                                                                                                                                                                  |
| `settings.privacy.card_title`                 | Tudo fica no seu Mac                                                                                                                                                                                                                     | Everything stays on your Mac                                                                                                                                                                                                  |
| `settings.privacy.card_body`                  | O Islet não usa contas e não envia nada sobre você. A única conexão de rede é a busca por atualizações, quando você permite. O estado da reunião fica só na memória do app, e os nomes e fotos dos participantes nunca vão para os logs. | Islet uses no accounts and sends nothing about you. Its only network connection is the update check, when you allow it. The meeting state stays in the app's memory, and participants' names and photos never reach the logs. |
| `settings.privacy.logs`                       | Logs                                                                                                                                                                                                                                     | Logs                                                                                                                                                                                                                          |
| `settings.privacy.logs_desc`                  | Arquivos locais, sem dados pessoais.                                                                                                                                                                                                     | Local files, no personal data.                                                                                                                                                                                                |
| `settings.privacy.open_folder`                | Abrir pasta                                                                                                                                                                                                                              | Open folder                                                                                                                                                                                                                   |
| `settings.privacy.guide`                      | Guia inicial                                                                                                                                                                                                                             | Setup guide                                                                                                                                                                                                                   |
| `settings.privacy.review_onboarding`          | Rever onboarding                                                                                                                                                                                                                         | Show setup guide                                                                                                                                                                                                              |
| `settings.privacy.version`                    | Versão                                                                                                                                                                                                                                   | Version                                                                                                                                                                                                                       |
| `settings.privacy.source`                     | Código-fonte                                                                                                                                                                                                                             | Source code                                                                                                                                                                                                                   |
| `settings.privacy.license`                    | Licença                                                                                                                                                                                                                                  | License                                                                                                                                                                                                                       |
| `settings.privacy.license_value`              | MIT ou Apache-2.0                                                                                                                                                                                                                        | MIT or Apache-2.0                                                                                                                                                                                                             |
| `updates.section`                             | Atualizações                                                                                                                                                                                                                             | Updates                                                                                                                                                                                                                       |
| `updates.auto`                                | Procurar atualizações automaticamente                                                                                                                                                                                                    | Check for updates automatically                                                                                                                                                                                               |
| `updates.auto_desc`                           | Consulta o GitHub ao abrir o app e uma vez por dia. Nada sobre você é enviado.                                                                                                                                                           | Asks GitHub when the app opens and once a day. Nothing about you is sent.                                                                                                                                                     |
| `updates.check_now`                           | Procurar agora                                                                                                                                                                                                                           | Check now                                                                                                                                                                                                                     |
| `updates.install`                             | Instalar e reiniciar                                                                                                                                                                                                                     | Install and restart                                                                                                                                                                                                           |
| `updates.status_idle`                         | Você está na versão {version}.                                                                                                                                                                                                           | You're on version {version}.                                                                                                                                                                                                  |
| `updates.status_checking`                     | Procurando atualizações…                                                                                                                                                                                                                 | Checking for updates…                                                                                                                                                                                                         |
| `updates.status_up_to_date`                   | Você está na versão mais recente.                                                                                                                                                                                                        | You're on the latest version.                                                                                                                                                                                                 |
| `updates.status_available`                    | A versão {version} está disponível.                                                                                                                                                                                                      | Version {version} is available.                                                                                                                                                                                               |
| `updates.status_installing`                   | Baixando e instalando. O Islet vai reiniciar.                                                                                                                                                                                            | Downloading and installing. Islet will restart.                                                                                                                                                                               |
| `updates.status_check_failed`                 | Não foi possível procurar atualizações. Verifique a conexão e tente de novo.                                                                                                                                                             | Couldn't check for updates. Check your connection and try again.                                                                                                                                                              |
| `updates.status_install_failed`               | Não foi possível instalar a atualização. Tente de novo.                                                                                                                                                                                  | Couldn't install the update. Try again.                                                                                                                                                                                       |

### Tray menu

`tray.demo` (demo mode) appears only in development builds: a released app shows only what
works for real.

| Key                     | pt-BR                                   | en                                    |
| ----------------------- | --------------------------------------- | ------------------------------------- |
| `tray.connected`        | Conectado ao Chrome                     | Connected to Chrome                   |
| `tray.disconnected`     | Extensão não conectada                  | Extension not connected               |
| `tray.finish_setup`     | Concluir configuração…                  | Finish setup…                         |
| `tray.demo`             | Modo demo                               | Demo mode                             |
| `tray.settings`         | Configurações…                          | Settings…                             |
| `tray.onboarding`       | Rever onboarding                        | Show setup guide                      |
| `tray.quit`             | Sair do Islet                           | Quit Islet                            |
| `tray.update_available` | Instalar a versão {version} e reiniciar | Install version {version} and restart |
| `tray.updating`         | Instalando atualização…                 | Installing update…                    |

### Island

| Key                       | pt-BR                                                                        | en                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `island.expand`           | Expandir controles da reunião                                                | Expand meeting controls                                                 |
| `island.collapse`         | Recolher a ilha                                                              | Collapse the island                                                     |
| `island.speaking_now`     | Falando agora                                                                | Speaking now                                                            |
| `island.last_speaker`     | Falou por último                                                             | Last speaker                                                            |
| `island.participants`     | {n} na chamada                                                               | {n} in the call                                                         |
| `island.you`              | Você                                                                         | You                                                                     |
| `island.mic`              | Microfone                                                                    | Microphone                                                              |
| `island.mic_muted`        | Mudo                                                                         | Muted                                                                   |
| `island.mic_aria_mute`    | Desativar microfone                                                          | Mute microphone                                                         |
| `island.mic_aria_unmute`  | Ativar microfone                                                             | Unmute microphone                                                       |
| `island.cam`              | Câmera                                                                       | Camera                                                                  |
| `island.cam_off`          | Sem vídeo                                                                    | Camera off                                                              |
| `island.cam_aria_off`     | Desativar câmera                                                             | Turn camera off                                                         |
| `island.cam_aria_on`      | Ativar câmera                                                                | Turn camera on                                                          |
| `island.hand_raise`       | Levantar mão                                                                 | Raise hand                                                              |
| `island.hand_lower`       | Abaixar mão                                                                  | Lower hand                                                              |
| `island.open_tab`         | Abrir aba                                                                    | Open tab                                                                |
| `island.open_tab_aria`    | Abrir a aba da reunião                                                       | Open the meeting tab                                                    |
| `island.leave`            | Sair                                                                         | Leave                                                                   |
| `island.leave_aria`       | Sair da reunião                                                              | Leave the meeting                                                       |
| `island.unknown`          | Estado desconhecido                                                          | Unknown state                                                           |
| `island.alert`            | Você está falando com o microfone desligado                                  | You're talking while muted                                              |
| `island.alert_dismiss`    | Ignorar                                                                      | Dismiss                                                                 |
| `island.alert_unmute`     | Ativar microfone                                                             | Unmute                                                                  |
| `island.ended`            | Encerrada                                                                    | Ended                                                                   |
| `island.degraded_tooltip` | O Islet não encontrou parte da interface do Meet. Alguns dados podem faltar. | Islet couldn't find part of Meet's interface. Some data may be missing. |

---

## 7. Acceptance checks for Phase 5

- [ ] Onboarding and settings render correctly in light and dark. Switching the macOS appearance while a window is open updates it without reopening.
- [ ] No white flash when opening a window in dark mode.
- [ ] Island and pill stay black in both themes; the tray icon is a template image.
- [ ] Step 2 reaches `connected` only on a real `hello`; the 60 s troubleshooting link appears.
- [ ] Turning "Mostrar nomes dos participantes" off removes names from the `UiSnapshot` itself (covered by a core test), not just from the UI.
- [ ] "Copiar diagnóstico" output contains no names, titles or meeting codes (covered by a test).
- [ ] Changing the language in Settings updates every window and the island immediately.
- [ ] Every string comes from the pt-BR/en dictionary. No hard-coded UI copy.
- [ ] VoiceOver reads every control; switches announce their on/off state.
