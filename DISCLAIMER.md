# Legal Disclaimer & Terms of Use

**Last Updated:** August 26, 2026

Please read this document carefully before installing, deploying, or utilizing **Graywood Reader** ("the Software"). By downloading, installing, compiling, or using this software in any form, you signify your agreement to the terms, conditions, and disclaimers outlined below. If you do not agree with these terms, do not install or use the software.

---

## 1. Technical Nature & Scope of the Software

Graywood Reader is an **open-source, self-hosted, technical indexing application, catalog manager, and client-side reader**. It is designed strictly to provide technical tooling for organizing, viewing, and keeping track of web content and personal digital documents (such as CBZ/ZIP archives) that users have lawful access to.

- **Client Software Only:** Graywood Reader functions exclusively as client software operating on the user's local hardware or self-hosted server environment.
- **No Central Infrastructure:** The authors, maintainers, and contributors of Graywood Reader do not operate, control, or maintain any central media servers, content delivery networks (CDNs), streaming backends, cloud databases, or distribution platforms for copyrighted works.

---

## 2. No Content Hosting, Storage, or Redistribution

- **Zero Content Bundling:** The source repository, binary releases, Docker images, and package distributions of Graywood Reader do not contain, host, stream, or distribute any copyrighted media, comic pages, manga, manhwa, manhua, novels, or scanlation archives.
- **Local Caching Only:** Any temporary caching of image data, thumbnails, chapter downloads, or database records occurs entirely on the user's private computer, server disk, or local browser storage (`IndexedDB` / local directory), initiated strictly at the explicit command of the user.

---

## 3. Third-Party Sources, Scrapers, and Parsers

Graywood Reader includes modular parser schemas and scraping instructions designed to interpret publicly accessible HTML documents and public web APIs across the internet.

- **No Affiliation:** The developers and contributors of Graywood Reader have **no affiliation, association, sponsorship, partnership, endorsement, or business relationship** with any third-party websites, web hosts, scanlation teams, manga aggregators, or external domain owners accessible through parser definitions.
- **No Monitoring or Endorsement:** Graywood Reader does not monitor, verify, filter, curate, or guarantee the legality, accuracy, quality, copyright standing, safety, or continued availability of materials hosted on third-party domains.
- **Dynamic Retrieval:** Parser definitions are technical rules for DOM interpretation. When a user requests a chapter or search result, the user's own client directly queries the third-party endpoint.

---

## 4. User Responsibility & Compliance with Local Laws

- **Legal Compliance:** Users assume **sole and absolute responsibility** for ensuring that their use of Graywood Reader complies with all applicable local, national, and international copyright laws, intellectual property rights, and terms of service governing third-party websites they choose to access.
- **Personal & Non-Commercial Use:** The software is provided for personal, archival, and non-commercial research and organization. Users are responsible for obtaining appropriate permissions or licenses for any copyrighted content they access, download, or index.

---

## 5. DMCA & Copyright Infringement Procedures

Because Graywood Reader is a standalone client application that does not host, store, or distribute any media content on any developer-controlled servers:

- **Direct Inquiries to Source Hosts:** Any Digital Millennium Copyright Act (DMCA) notices, copyright infringement claims, or takedown requests regarding specific media, images, or series must be submitted directly to the third-party web host, domain operator, or scanlation platform actually hosting and transmitting the content.
- **Repository Removal Requests:** If a copyright holder or trademark owner believes that a specific parser definition, script, or technical module within this repository infringes upon their rights, please contact the maintainers via the security/contact channels specified in [`SECURITY.md`](SECURITY.md) with detailed identification of the file in question.

---

## 6. Security, Privacy, and Local Data Sovereignty

- **Data Privacy:** Graywood Reader does not collect telemetry, personal browsing history, reading analytics, or tracking data. All metadata, library progress, reading logs, and credentials remain private on your self-hosted instance.
- **Encryption:** Stored sensitive tokens (such as third-party API keys or tracker credentials) are encrypted locally using AES-256-GCM when an encryption secret is provided.
- **SSRF & Defensive Networking:** Built-in safeguards protect local intranets from Server-Side Request Forgery (SSRF) by restricting scraper and proxy connections to public routable IP addresses.

---

## 7. Warranty Disclaimer & Limitation of Liability

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. 

IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

For licensing information, see [`LICENSE`](LICENSE) (GNU General Public License v3.0 or later). For third-party notices, see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
