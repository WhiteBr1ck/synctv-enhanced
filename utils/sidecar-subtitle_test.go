package utils

import "testing"

func TestSubtitleNameMatching(t *testing.T) {
	for _, tc := range []struct {
		name, language string
		rank           int
	}{
		{"Show.S01E01.ass", "", 2}, {"show.s01e01.CHS.SRT", "zh-Hans", 1},
		{"Show.S01E01.en.forced.vtt", "en", 1}, {"Show.S01E01.zh-Hant.ass", "zh-Hant", 1},
		{"Show.S01E010.zh.srt", "zh", 0}, {"Show.S01E02.srt", "", 0},
		{"Show.S01E01.other.ass", "", 0}, {"Show.S01E01.mkv", "", 0},
	} {
		language, rank := MatchSubtitleFile("Show.S01E01.mkv", tc.name)
		if language != tc.language || rank != tc.rank {
			t.Errorf("%q: got %q/%d", tc.name, language, rank)
		}
	}
}

func TestSubtitleBasenames(t *testing.T) {
	for _, name := range []string{"../other.srt", "a/b.ass", `a\b.srt`, "x\x00.srt", "x.xml", "", "x.srt/../a"} {
		if ValidSubtitleFile(name) {
			t.Errorf("accepted %q", name)
		}
	}
	if !ValidSubtitleFile("字幕 简体中文.SRT") {
		t.Fatal("ordinary subtitle basename rejected")
	}
}
