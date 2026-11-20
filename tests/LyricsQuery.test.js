/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

import { test, assertEqual, assertTrue, assertFalse, assertDeepEqual } from './lib/assert.js';
import { lyricsQueries, titlesMatch, cacheKey } from '../src/ui/modules/music/LyricsQuery.js';


test('lyricsQueries: a plain track keeps its title and artist', () => {
    assertDeepEqual(lyricsQueries('Anti-Hero', 'Taylor Swift, Bleachers'), [{ title: 'Anti-Hero', artist: 'Taylor Swift' }]);
});

test('lyricsQueries: a player suffix is tried as a suffix first', () => {
    assertDeepEqual(lyricsQueries('Heroes - 2017 Remaster', 'David Bowie'), [
        { title: 'Heroes', artist: 'David Bowie' },
        { title: '2017 Remaster', artist: 'Heroes' },
    ]);
});

test('lyricsQueries: a video title led by the channel\'s artist is read as artist - song', () => {
    assertDeepEqual(lyricsQueries('ヨルシカ - ただ君に晴れ (MUSIC VIDEO)', 'ヨルシカ / n-buna Official')[0],
        { title: 'ただ君に晴れ', artist: 'ヨルシカ' });
});

test('lyricsQueries: a quoted song name wins over the words around it', () => {
    assertDeepEqual(lyricsQueries('ヨルシカ - LIVE「レプリカント」', 'ヨルシカ / n-buna Official')[0],
        { title: 'レプリカント', artist: 'ヨルシカ' });
    assertDeepEqual(lyricsQueries('ヨルシカ「春泥棒」OFFICIAL VIDEO', 'ヨルシカ / n-buna Official')[0],
        { title: '春泥棒', artist: 'ヨルシカ' });
});

test('lyricsQueries: an artist written differently from the channel is still tried', () => {
    const queries = lyricsQueries('Yorushika - Thought Crime (OFFICIAL VIDEO)', 'ヨルシカ / n-buna Official');
    assertDeepEqual(queries[1], { title: 'Thought Crime', artist: 'Yorushika' });
});

test('titlesMatch: rejects another song by the same artist', () => {
    assertTrue(titlesMatch('レプリカント', 'レプリカント'));
    assertTrue(titlesMatch('Heroes (2017 Remaster)', 'heroes'));
    assertFalse(titlesMatch('風を食む', 'ヨルシカ'));
    assertFalse(titlesMatch('', 'ヨルシカ'));
});

test('cacheKey: two videos of one channel do not share a key', () => {
    const artist = 'ヨルシカ / n-buna Official';
    assertFalse(cacheKey('ヨルシカ - LIVE「レプリカント」', artist) === cacheKey('ヨルシカ - ただ君に晴れ', artist));
    assertEqual(cacheKey(' Heroes ', 'David Bowie, Queen'), 'heroes::david bowie');
});
