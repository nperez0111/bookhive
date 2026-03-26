---
theme: seriph
title: "Store the Maximally Useful Data"
info: |
  ATmosphereConf 2026
  Nick (@bookhive.buzz)
class: text-[#3f2f18]
transition: slide-left
comark: true
duration: 15min
drawings:
  persist: false
background: '#daa731'
fonts:
  sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",
        "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"
  provider: none
---

<h1 style="letter-spacing: -0.04em" class="font-bold">The Design Philosophy<br />of BookHive</h1>

<img src="/barry_alone_no_bg.svg" width="250" height="250" style="position: absolute; top: 275px;" />


<span class="text-center">Storing the maximally useful data to the user's PDS</span>

<div class="pt-12">
  <span class="px-2 py-1 rounded">
    Nick Perez / <svg viewBox="0 0 24 24" class="h-4 w-4 fill-current inline" aria-hidden="true">
      <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
    </svg>&nbsp;<strong>@nickthesick.com</strong>
  </span>
</div>

<div class="abs-br m-6 flex gap-2 text-sm opacity-70">
  ATmosphereConf 2026
</div>

<!--
Welcome everyone. I'm Nick, I build BookHive -- a Goodreads alternative built on AT Protocol. Today I want to talk about something I think is underexplored: not *why* to build on atproto, but *how* to build in a way that's truly atproto-native. Specifically, how to think about the data you store in a user's PDS.
-->

---
layout: cover
background: '#3f2b08'
class: text-white text-left
---

<h1 class="font-bold">The <span style="color: #eac741">Opportunity</span></h1>

ATProto is a _trend-reversal_. The web started open, but became progressively closed down.

<v-click>

 - Social Networks, in particular, have become **data silos**.

</v-click>

<v-click>

 - User agency is at an all-time low, what happened to software _solving your problems_.

</v-click>

<v-click>

Most talks here cover *why* atproto. This one is about **how** -- how do you actually build in a way that's atproto-native?

</v-click>

<!--
We all know the pitch for atproto. User-owned data. Portability. Open ecosystem. But when you sit down to actually design a lexicon and decide what goes into a PDS record, you face real tradeoffs. And the choices you make there determine whether you're really delivering on the promise or just recreating a silo with extra steps.
-->

---

# BookHive

A Goodreads alternative built on AT Protocol.

<v-click>

- Users track books, rate them, write reviews
- All reading data stored in the user's PDS
- ~3,000 users, ~250,000 book records on protocol

</v-click>

<v-click>

Today: the design decisions behind those records, and what I learned.

</v-click>

<!--
Quick context on BookHive. It's a reading tracker -- think Goodreads but built on atproto. Users add books to their library, track reading status, rate and review them. All of that data is written to their PDS as AT Protocol records. We've been live for a while now and have about 3,000 users with a quarter million book records on protocol. What I want to share today are the design decisions behind those records and the principles I've extracted from building this.
-->

---

# The Temptation

BookHive has a `hiveId` -- a hash of title + author that uniquely identifies every book.

<v-click>

Storing just this ID would be "efficient":

```json
{
  "hiveId": "a1b2c3d4e5f6",
  "status": "finished",
  "stars": 8,
  "createdAt": "2025-06-15T..."
}
```

</v-click>

<v-click>

It's all the app needs to look up the book. But it's **useless** to the user and **useless** to any other app.

</v-click>

<!--
So here's the temptation. BookHive has an internal ID system -- a hash of title plus author. If I were building a traditional web app, I'd store this ID plus the user's status and rating, and call it a day. It's normalized. It's efficient. It's what any good database design would look like. But a PDS is not a database. If someone exports their data or another app reads their PDS, what does "a1b2c3d4e5f6" mean? Nothing. It's an opaque reference to BookHive's internal system.
-->

---
layout: two-cols
layoutClass: gap-8
---

# What We Actually Store

```json
{
  "title": "The Left Hand of Darkness",
  "authors": "Ursula K. Le Guin",
  "cover": { /* blob */ },
  "identifiers": {
    "isbn13": "9780441478125",
    "isbn10": "0441478123",
    "goodreadsId": "18423"
  },
  "status": "finished",
  "stars": 9,
  "review": "A masterwork of ...",
  "startedAt": "2025-05-01T...",
  "finishedAt": "2025-06-10T...",
  "hiveId": "a1b2c3d4e5f6",
  "hiveBookUri": "at://did:plc:.../..."
}
```

::right::

<div class="mt-12">

<v-click>

**Everything someone needs to understand:**

- What book is this?
- What's my relationship with it?
- How can other apps find it?

</v-click>

<v-click>

The record is **self-describing**.

No API call required to make sense of it.

</v-click>

</div>

<!--
Here's what we actually store. Title, authors, a cover image as a blob, standard identifiers like ISBN-10, ISBN-13, and Goodreads ID. Reading status, rating, review text, dates. And yes, the hiveId is still there for BookHive's internal use, plus a link to our catalog record. But the key point is: this record stands on its own. You can look at it and know exactly what book this is, what the user thought of it, and when they read it. No API call to BookHive required.
-->

---

# The "Day After" Test

> If BookHive disappeared tomorrow, is the data in your PDS still meaningful?

<v-click>

**With just an ID:** No. An opaque hash with no service to resolve it.

</v-click>

<v-click>

**With full records:** Yes.

- You have your books -- titles, authors, covers
- You have your ratings and reviews
- You have your reading history
- Other apps can use ISBNs to cross-reference

</v-click>

<v-click>

This is the litmus test for every PDS record you design.

</v-click>

<!--
Here's the litmus test I use for every design decision: the "day after" test. If BookHive shut down tomorrow, what happens to the data in users' PDSes? With the minimal approach -- just an ID -- that data becomes meaningless. An opaque hash pointing to a dead service. With full records, users still have their complete reading history. Titles, authors, covers, reviews, dates. And because we include ISBNs, any other book app can pick up that data and work with it. The records survive the service.
-->

---

# The Catalog Account

<CatalogDiagram />

<!--
Some data is too large to duplicate into every user's PDS -- full book descriptions, genre taxonomies, series information. So BookHive scrapes and enriches data from multiple sources -- Goodreads, Google Books, ISBNdb -- and publishes canonical book records to our catalog account @bookhive.buzz, on protocol. Users' records link to these via hiveBookUri. And critically, this catalog data is open. Anyone can read it. Other apps like Popfeed and personal websites can read both the user's PDS and the catalog directly, without calling our API. Pattern: enrich data centrally, publish it openly, let users reference it.
-->

---

# Proof It Works

Other apps already consume BookHive data -- without calling our API.

<v-click>

**Personal websites** pull book records from users' PDSes to display "what I'm reading" sections.

</v-click>

<v-click>

**Popfeed** reads BookHive records and displays books with their own shelf system.

</v-click>

<v-click>

This only works **because** the records contain real data -- title, authors, cover, identifiers.

Not opaque IDs that require calling BookHive.

</v-click>

<!--
And here's the proof that this approach works. Other developers are already building on BookHive data without any coordination with us. People have built personal websites that pull their book records directly from their PDS to show a "currently reading" section. Popfeed, another app in the ecosystem, reads BookHive records and displays them with their own UI and shelf system. None of this would work if we'd stored just an opaque ID. These apps don't call BookHive's API -- they read the PDS directly, and the records have everything they need.
-->

---
layout: center
---

# A PDS Is Not a Database

<!--
So let me name the principle behind all of this.
-->

---

# The Mindset Shift

<div class="grid grid-cols-2 gap-8 mt-4">
<div>

### Database Mindset

<v-click>

- Deduplicate
- Normalize
- Store references
- Optimize for your queries
- Data serves the application

</v-click>

</div>
<div>

### PDS Mindset

<v-click>

- Include context
- Be self-describing
- Use standard identifiers
- Optimize for the *user*
- Data serves the person who owns it

</v-click>

</div>
</div>

<v-click>

<div class="mt-8 text-center">

When you store data in a user's PDS, you're not optimizing for your app's queries.

You're **giving data to the user**.

</div>

</v-click>

<!--
When we design traditional databases, we think about normalization. Don't repeat yourself. Store a foreign key, join at query time. That's great for databases. But a PDS is not a database. When you write a record to someone's PDS, you're not optimizing for your app's query patterns. You're giving data to a person. And the question becomes: is this data useful to them? Can they understand it? Can other apps use it? I think of this as "Database User Experience" -- what's the experience of someone looking at their own data?
-->

---
layout: center
class: text-center
---

# "Store the maximally useful data."

<v-click>

The data you write to a PDS should be as useful as possible to the person who owns it.

</v-click>

<!--
So here's the core principle, in one sentence. Store the maximally useful data. Not the minimum your app needs. Not a full database dump. The maximally useful data -- the richest, most self-describing version of the record that makes sense for the user to own.
-->

---

# Three Principles for Builders

<v-click>

### 1. Store what's useful to the user, not just to you.

Records should be **self-describing**. Someone looking at a PDS record should understand what it represents without calling your API.

</v-click>

<v-click>

### 2. Use standard identifiers. Publish open datasets on-protocol.

ISBNs, DOIs, URLs -- anything that lets other apps cross-reference. The enrichment work you do can benefit the whole ecosystem.

</v-click>

<v-click>

### 3. Apply the "day after" test.

If your service shuts down tomorrow, is the user's PDS data still valuable? If not, rethink what you're storing.

</v-click>

<!--
Three actionable takeaways. First: store what's useful to the user, not just what's useful to you. Make records self-describing. Second: use standard identifiers wherever they exist, and publish your enriched datasets on protocol. ISBNs for books, DOIs for papers, URLs -- whatever helps other apps cross-reference and build on your work. Third: apply the day after test. If your service disappears, is the data in the PDS still valuable? If the answer is no, you have a design problem.
-->

---
layout: center
class: text-center
---

# We have an opportunity to build social software where the data actually belongs to people.

<v-click>

Let's not waste it by storing opaque IDs.

</v-click>

<v-click>

Next time you design a lexicon, ask:

**"Is this record useful to the person who owns it?"**

</v-click>

<div class="abs-br m-6 flex gap-2 text-sm opacity-50">
  @bookhive.buzz
</div>

<!--
We have a real opportunity here. AT Protocol gives us the infrastructure to build social software where the data genuinely belongs to people. But infrastructure alone isn't enough -- we have to make good design choices on top of it. So next time you sit down to design a lexicon, ask yourself: is this record useful to the person who owns it? If it is, you're building something that lasts. Thank you.
-->
