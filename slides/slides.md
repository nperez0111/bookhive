---
theme: seriph
title: "The Design Philosophy of BookHive"
info: |
  ATmosphereConf 2026
  Nick (@bookhive.buzz)
class: text-[#3f2f18]
transition: slide-left
comark: true
duration: 10min
drawings:
  persist: false
background: '#daa731'
fonts:
  sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",
        "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"
  provider: none
---

<h1 style="letter-spacing: -0.04em" class="font-bold">The Design Philosophy<br />of BookHive</h1>

<img src="/barry_alone_no_bg.svg" width="250" height="250" style="position: absolute; top: 275px; filter: drop-shadow(0 8px 4px rgba(0, 0, 0, 0.35))" />


<span class="text-center">Storing the maximally useful data for the user's agency</span>

<div class="pt-12">
  <span class="px-2 py-1 rounded">
    Nick Perez / <svg viewBox="0 0 24 24" class="h-5 w-5 inline" style="fill: rgb(15, 115, 255)" aria-hidden="true">
      <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
    </svg>&nbsp;<strong style="color: rgb(15, 115, 255); font-weight: 800">@nickthesick.com</strong>
  </span>
</div>

<div class="abs-br m-6 flex gap-2 text-sm">
  ATmosphereConf 2026
</div>

<!--
Welcome everyone. I'm Nick, I build BookHive -- a Goodreads alternative built on AT Protocol. Today I want to talk about the design philosophy behind BookHive, and specifically how I think about the data we store in users' PDSes.
-->

---
layout: cover
background: '#3f2b08'
class: text-white text-left
---

<h1 class="font-bold">The <span style="color: #eac741">Opportunity</span></h1>

ATProto is a _trend-reversal_. The web started open, but became progressively closed down.

<v-click>

 - Social Networks have become **data silos**. If you don't pay for it, you are the product.

</v-click>

<v-click>

 - User agency is at an all-time low - forced through upgrades, with no other recourse.

</v-click>

<v-click>

 - APIs are closing down. Especially with AI, data is seen as a **moat**.

</v-click>

<!--
What ATProto represents is a trend reversal. The web started as open, and became progressively more closed down. Social networks in particular have become data silos. If you don't pay for it, you are the product. User agency is at an all-time low -- users are forced through upgrades with no other recourse. And APIs are closing down left and right, especially now that AI has made companies view their data as a moat.
-->

---
layout: cover
background: '#3f2b08'
class: text-white text-left
---

<h1 class="font-bold">The <span style="color: #eac741">User-Agent</span></h1>

The web came with this idea of a **user-agent** -- allowing users to customize their experience according to their needs.

<v-click>

It largely didn't pan out. The complexity of sharing data naturally led to the rise of locked-down APIs.

</v-click>

<v-click>

But of course, that's why you're all here -- to build an **open web based on user agency**.

</v-click>



<!--
We often forget that the web came with this idea of a user-agent, allowing users to customize their experience according to their needs. It largely didn't pan out because of the complexity of sharing data -- it naturally led to the rise of locked-down APIs. But of course, that is part of why you are all here, to see an open web, based on user agency. ATProto gives us the infrastructure to actually deliver on that promise.
-->
---
layout: cover
background: '#f9eabc'
class: text-[#3f2b08] text-left
---

<img src="./screenshot.jpg" width="500px" class="ml-8 mt-4 border-rounded drop-shadow-amber drop-shadow-xl" align="right" />

<h1 class="font-bold mt-8" style="color: #3f2b08">BookHive</h1>

<p style="opacity: 1">An <b style="color: #000">open source, open data</b> alternative to Goodreads, built on AT Protocol.</p>

- Track your books, organize your shelves, connect with readers
- All data stored in the <b style="color: #000">user's PDS</b>
- ~1,000 users, >=250,000 book records




<!--
BookHive is an open source, open data alternative to Goodreads. You can track your books, organize your shelves and connect with others who read the same books as you. When building BookHive, my thinking was all about storing the maximally useful data in the user's PDS. This means data the user and other applications can actually work with.
-->

---

<h1 class="font-bold" style="color: #eac741">What We
  <span style="display: inline-block; position: relative;">
    <Transition name="swap">
      <span v-if="$clicks < 1" key="can" style="color: white">Can</span>
      <span v-else key="do" style="color: white">Do</span>
    </Transition>
  </span>
Store</h1>

<style>
.swap-enter-active, .swap-leave-active {
  transition: all 0.4s ease;
}
.swap-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.swap-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
.swap-leave-active {
  position: absolute;
}
</style>

<span v-if="$clicks < 1">BookHive has a single ID for every book. It _could_ just store that and be done with it.</span>
<span v-else>A self-describing record of the user's intent: stuff apps or users actually need.</span>

````md magic-move
```json
// The "efficient" approach
{
  "hiveId": "bk_FEQcl1dxSUgnRbODU6cK",
  "status": "finished",
  "createdAt": "2026-03-26T19:13:50.944Z"
}
```

```json
// What we actually store
{
  "title": "Bee Movie",
  "authors": "Susan Korman",
  "cover": { "$type": "blob", "mimeType": "image/jpeg", "size": 34941 },
  "owned": true,
  "status": "buzz.bookhive.defs#finished",
  "createdAt": "2026-03-26T19:13:50.944Z",
  "finishedAt": "2026-03-26T00:00:00.000Z",
  "hiveId": "bk_FEQcl1dxSUgnRbODU6cK",
  "hiveBookUri": "at://did:plc:.../buzz.bookhive.catalogBook/bk_...",
  "identifiers": {
    "isbn13": "9780061251788",
    "isbn10": "006125178X",
    "goodreadsId": "1646160"
  }
}
```
````

---
layout: center
class: text-center
---

<h1 class="font-bold" style="color: #eac741">We have an opportunity to build social software where the data actually belongs to people.</h1>


<h2 class="mt-20">Let's not waste it by storing opaque IDs.</h2>

<v-click>

<h1 style="color: #fff" class="mt-12">
    The PDS is not just a database
</h1>

</v-click>


---
layout: cover
---

<h1 class="font-bold" style="color: #eac741">The "Day After" Test</h1>


<h2>If BookHive disappeared tomorrow, is the data in your PDS still meaningful?</h2>


---
class: text-[#1c1917] bg-[#f9eabc]
---

<h1 style="color: rgb(146 64 14)">A central store of book data within <span class="font-extrabold">@bookhive.buzz</span></h1>


<v-click>

<CatalogDiagram />

</v-click>

<!--
If BookHive disappeared tomorrow, is the data in your PDS still meaningful? Yes. We maintain a catalog -- a central store of book data under the @bookhive.buzz service account. This means all book data is on protocol. Everything on BookHive can be reconstructed purely from data available on the network. Users' records link to the catalog via a hiveBookUri. The catalog stores the enriched data -- descriptions, genres, series information -- that would be too large to duplicate into every user's PDS.
-->

---
layout: statement
---

<h1 class="font-bold" style="color: #eac741">Proof It Works</h1>

### Other apps already use BookHive data -- without our API.

---
class: text-[#1c1917] bg-[#f9eabc]
---

<h1 class="font-bold" style="color: #3f2b08">Popfeed</h1>

<p style="color: rgb(146 64 14); opacity: 1">An application for books, movies and tv shows, by <b class="font-bolder">@cjfulton.bsky.social</b></p>

<img src="./popfeed.jpg" class="mx-auto border-rounded drop-shadow-xl" width="530px">

<p class="text-center">Popfeed is able to display BookHive books, within Popfeed</p>



---

<h1 class="font-bold" style="color: #eac741">Book Explorer</h1>

An **alternative front-end** to manage your books, by **@tijs.org**

<img src="./book-explorer.jpg" class="mx-auto border-rounded drop-shadow-xl" width="530px">

<p class="text-center">They are your books, choose how you want to manage them.</p>

---
layout: statement
---

<h2 style="color: #fff" class="mb-8">
  This only works because BookHive stores
</h2>
<h1 class="font-bold" style="color: #fff">The <b style="color: #eac741">maximally useful data</b> <br />in service of the user</h1>



---


<h1 class="font-bold" style="color: #eac741">Takeaways for Builders</h1>

<v-click>

<h3 style="color: #d4a017; font-size: 1.5em" class="mt-12">1. Store what's useful to the user, not just to you.</h3>

Include enough context that the record is self-describing. The **PDS is not just a database**.

</v-click>

<v-click>

<h3 style="color: #d4a017; font-size: 1.5em" class="mt-12">2. Use standard identifiers. Publish open datasets on-protocol.</h3>

ISBNs, DOIs, URLs -- anything that lets other apps cross-reference. It's actually _very hard_ to get a good book dataset. Your enrichment work can benefit everyone.

</v-click>

<v-click>

<h3 style="color: #d4a017; font-size: 1.5em;" class="mt-12">3. The "day after" test.</h3>

If your service shuts down tomorrow, is the user's PDS data still valuable? If not, rethink what you're storing.

</v-click>

<!--
Three takeaways. First: store what's useful to the user, not just what's useful to you. Include enough context that the record is self-describing. Someone looking at a PDS record should understand what it represents without calling your API. The PDS is not just a database. Second: use standard identifiers wherever they exist, and publish your enriched datasets on protocol. It's actually very hard to get a good book dataset -- the enrichment work you do can benefit everyone, not just your users. Third: the day after test. If your service shuts down tomorrow, is the user's PDS data still valuable? If not, rethink what you're storing.
-->

---
layout: center
class: text-center
---


<h1 class="font-bold" style="color: #eac741">Empower users</h1>

<v-click>
<h1 class="font-bold" style="color: #eac741">Be their agent</h1>
</v-click>

<v-click>
<h1 class="font-bold" style="color: #eac741">Open Data</h1>
</v-click>

<v-click>
<h1 class="font-bold" style="color: #eac741">Open Source</h1>
</v-click>

---
layout: center
---

<h1 style="color: #fff; font-size: 90px">Thank you!</h1>

<img src="./hive.png" width="450px" class="mt-20 mx-auto border-rounded-xl drop-shadow-amber shadow-xl" />

<div class="abs-bl m-6 flex gap-2 text-lg">
  @nickthesick.com
</div>

<div class="abs-br m-6 flex gap-2 text-lg">
  @bookhive.buzz
</div>
