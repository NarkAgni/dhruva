<div align="center">
  <img src="icons/logo.svg" alt="Dhruva Logo" width="112" height="112">
  <br>
  <h1>Dhruva</h1>
  <p><strong>A clean and customizable dock for GNOME Shell</strong></p>

  <p>
    <a href="https://extensions.gnome.org/extension/9495/dhruva/"><img src="https://img.shields.io/badge/GNOME_Shell-45_to_51-4A86CF?style=flat-square&logo=gnome&logoColor=white" alt="GNOME Shell"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL_v3-blue.svg?style=flat-square" alt="License"></a>
    <a href="https://github.com/narkagni/dhruva/releases"><img src="https://img.shields.io/github/v/release/narkagni/dhruva?style=flat-square" alt="Release"></a>
    <a href="https://extensions.gnome.org/extension/9495/dhruva/"><img src="https://img.shields.io/badge/dynamic/json?style=flat-square&color=orange&label=Downloads&query=%24.downloads&url=https%3A%2F%2Fextensions.gnome.org%2Fextension-query%2F%3Fsearch%3Ddhruva" alt="Downloads"></a>
  </p>

  <p>
    <a href="https://extensions.gnome.org/extension/9495/dhruva/"><b>Install via EGO</b></a> &bull;
    <a href="https://github.com/narkagni/dhruva/issues"><b>Report Issue</b></a> &bull;
    <a href="#support-development"><b>Donate</b></a>
  </p>
</div>

<hr>

<p align="center">
  <img src="media/dock.png" alt="Dhruva Dock Main Preview" width="100%">
</p>

<h2>Feature Highlights</h2>

<table width="100%">
  <thead>
    <tr>
      <th width="50%" align="center">Physics &amp; Magnification</th>
      <th width="50%" align="center">Window Shaders</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <img src="media/magnifier.gif" alt="Magnification" width="100%">
        <p><sub><b>Fluid Motion:</b> Hermite smoothstep zoom curves, slot expansion &amp; outward rise.</sub></p>
      </td>
      <td align="center" valign="top">
        <img src="media/genie.gif" alt="Window Minimize Effects" width="100%">
        <p><sub><b>Custom Shaders:</b> Magic Lamp (Genie), Vortex, Origami, CRT, and Jelly minimize.</sub></p>
      </td>
    </tr>
  </tbody>
  <thead>
    <tr>
      <th width="50%" align="center">Window Previews</th>
      <th width="50%" align="center">App Stacks &amp; Folders</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <img src="media/peek.gif" alt="Aero Peek Previews" width="100%">
        <p><sub><b>Aero Peek:</b> Live thumbnails with instant on-screen window isolation.</sub></p>
      </td>
      <td align="center" valign="top">
        <img src="media/folder.png" alt="App Stacks & Folders" width="100%">
        <p><sub><b>Native Stacking:</b> Group apps directly via <code>Ctrl</code> + Drag with emoji icons.</sub></p>
      </td>
    </tr>
  </tbody>
  <thead>
    <tr>
      <th width="50%" align="center">Click Engine</th>
      <th width="50%" align="center">Preferences Control</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <img src="media/iconeffects.gif" alt="Click Animations" width="100%">
        <p><sub><b>Hardware Feedback:</b> 20+ responsive animations on item click.</sub></p>
      </td>
      <td align="center" valign="top">
        <img src="media/prefs.png" alt="Preferences UI" width="100%">
        <p><sub><b>Granular Customization:</b> Dial in geometries, spring physics, and color themes.</sub></p>
      </td>
    </tr>
  </tbody>
</table>

<hr>

<h2>Architecture &amp; Features</h2>

<ul>
  <li><b>Motion Engine:</b> Supports 6 magnification profiles (Coverflow, Jelly, Fluid, Domino, Cylinder, Magnetic) with dynamic slot push and custom axis elevation.</li>
  <li><b>Window Shaders:</b> Hardware-accelerated minimize routines including Magic Lamp, Vortex, Origami, CRT, and Jelly.</li>
  <li><b>Display Adaptability:</b> Omni-directional placement across all 4 screen edges, multi-monitor configuration, and edge-to-edge panel modes.</li>
  <li><b>Window Management:</b> Live Aero Peek previews, workspace isolation, and intelligent window dodge / auto-hide.</li>
  <li><b>Productivity Modules:</b> Integrated digital clock, shredding trash can, Quick Launch (<code>Super + 1-9</code>), and JSON profile import/export.</li>
</ul>

<hr>

<h2>Installation</h2>

<h3>Method 1: GNOME Extensions Website</h3>
<p>Install the verified build directly from the official portal:</p>
<p><a href="https://extensions.gnome.org/extension/9495/dhruva/"><b>extensions.gnome.org/extension/9495/dhruva</b></a></p>

<h3>Method 2: Manual Build</h3>

<pre><code>git clone https://github.com/narkagni/dhruva.git
cd dhruva
make install</code></pre>

<p><b>Restart your GNOME session:</b></p>
<ul>
  <li><b>X11:</b> Press <kbd>Alt</kbd> + <kbd>F2</kbd>, type <code>r</code>, and press <kbd>Enter</kbd></li>
  <li><b>Wayland:</b> Log out and log back in</li>
</ul>

<p><b>Enable the extension:</b></p>
<pre><code>gnome-extensions enable dhruva@narkagni</code></pre>

<hr>

<h2 id="support-development">Support Development</h2>

<p>Dhruva is free and open-source software distributed under the <b>GPL-3.0 license</b>. If it improves your Linux workflow, consider supporting its maintenance:</p>

<p align="center">
  <a href="https://buymeacoffee.com/narkagni">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48">
  </a>
</p>

<details>
  <summary><b>Cryptocurrency Addresses</b></summary>
  <br>
  <table>
    <tr>
      <td><b>Bitcoin (BTC)</b></td>
      <td><code>1GSHkxfhYjk1Qe4AQSHg3aRN2jg2GQWAcV</code></td>
    </tr>
    <tr>
      <td><b>Ethereum (ETH)</b></td>
      <td><code>0xf43c3f83e53495ea06676c0d9d4fc87ce627ffa3</code></td>
    </tr>
    <tr>
      <td><b>Tether (USDT - TRC20)</b></td>
      <td><code>THnqG9nchLgaf1LzGK3CqdmNpRxw59hs82</code></td>
    </tr>
  </table>
</details>

<hr>

<div align="center">
  <p>Maintained with precision by <a href="https://github.com/narkagni"><b>NarkAgni</b></a> &bull; Released under <b>GPL-3.0 License</b></p>
</div>
