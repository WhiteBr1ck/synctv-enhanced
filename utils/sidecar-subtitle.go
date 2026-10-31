package utils

import (
	"path"
	"strings"
)

var subtitleLanguages = map[string]string{
	"zh": "zh", "chi": "zh", "zho": "zh", "chs": "zh-Hans", "cht": "zh-Hant",
	"zh-cn": "zh-Hans", "zh-hans": "zh-Hans", "sc": "zh-Hans", "简体": "zh-Hans", "简中": "zh-Hans",
	"zh-tw": "zh-Hant", "zh-hant": "zh-Hant", "tc": "zh-Hant", "繁体": "zh-Hant", "繁中": "zh-Hant",
	"en": "en", "eng": "en", "ja": "ja", "jpn": "ja", "ko": "ko", "kor": "ko",
	"fr": "fr", "fre": "fr", "fra": "fr", "de": "de", "ger": "de", "deu": "de",
}

func SubtitleFileType(name string) string {
	switch ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), ".")); ext {
	case "srt", "ass", "ssa", "vtt":
		return ext
	default:
		return ""
	}
}

// Only a basename can be read from the current movie's directory.
func ValidSubtitleFile(name string) bool {
	return name != "" && !strings.ContainsAny(name, "/\\\x00") && SubtitleFileType(name) != ""
}

// Exact stems rank before language/accessibility suffixes. Arbitrary prefix
// matches would incorrectly bind episode 01's subtitles to episode 010.
func MatchSubtitleFile(video, subtitle string) (language string, rank int) {
	stem := strings.ToLower(strings.TrimSuffix(path.Base(video), path.Ext(video)))
	name := strings.ToLower(strings.TrimSuffix(subtitle, path.Ext(subtitle)))
	for _, token := range strings.Split(name, ".") {
		if value := subtitleLanguages[token]; value != "" {
			language = value
		}
	}
	if stem == "" || !ValidSubtitleFile(subtitle) {
		return language, 0
	}
	if name == stem {
		return language, 2
	}
	if !strings.HasPrefix(name, stem+".") {
		return language, 0
	}
	for _, token := range strings.Split(strings.TrimPrefix(name, stem+"."), ".") {
		if subtitleLanguages[token] != "" {
			continue
		}
		switch token {
		case "forced", "default", "sdh", "cc":
		default:
			return language, 0
		}
	}
	return language, 1
}
