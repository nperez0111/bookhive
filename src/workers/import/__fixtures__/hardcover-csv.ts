/**
 * Hardcover export sample, shared by the import-worker suite and the CSV
 * parser suite. It lives outside both because a `.test.ts` cannot export a
 * fixture safely: `import-logic.test.ts` has a top-level `await import(...)`
 * (it mocks before importing), so a test file importing from it starts running
 * its own tests while that module is still suspended, and the constant is
 * still in its temporal dead zone — "Cannot access 'HARDCOVER_CSV' before
 * initialization", but only under `bun test --parallel`.
 */
export const HARDCOVER_CSV = `Title,Author,Series,Status,Privacy,Hardcover Book ID,Hardcover Edition ID,ISBN 10,ISBN 13,ASIN,Media,Country Code,Language Code,Binding,Pages,Duration in Seconds,Publish Date,Publisher,Genres,Moods,Tags,Content Warnings,Lists,Date Added,Date Started,Date Finished,Rating,Review,Review Contains Spoilers,Sponsored Review,Review Date,Review URL,Review Media URL,Private Notes,Owned,Compilation,Review Slate
2666,"Roberto Bolaño, Natasha Wimmer (Translator)",2666 (#1.0),Want to Read,Public,75726,25012766,0374100144,9780374100148,0374100144,Book,us,en,,898,,2008-11-11,"Farrar, Straus and Giroux",,,,,"",2025-01-15,"","",,,false,false,2025-01-15T13:56:31Z,,,,false,No,{}
Burning Chrome,William Gibson,Sprawl (#0.0),Read,Public,2440,31159321,,,B0036G94XY,Audio,us,en,,191,25686,1986-04-01,Audible Frontiers,,,,,"Owned, Shelved By Genre Reading List (#19)",2025-01-10,2025-01-01,2025-01-23,4.5,,false,false,2025-01-10T17:21:40.987Z,,,,true,No,{}
Hyperion,"Helena Fraga (Translator), Kenneth Haigh (Narrator), Bernard Hepton (Narrator), Dan Simmons",Hyperion Cantos (#1.0),Currently Reading,Public,427460,30428122,0385263481,9780385263481,,Book,us,en,,492,,1989-05-26,Crown,,,,,Owned,2025-01-31,2023-09-01,,,,false,false,2025-01-15T13:56:57Z,,,"",true,No,{}`;
