package emby

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pb "github.com/synctv-org/vendors/api/emby"
	client "github.com/synctv-org/vendors/vendors/emby"
)

func TestFsListOmitsPlaybackSources(t *testing.T) {
	listed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/emby/Items/library/Ancestors":
			fmt.Fprint(w, `[]`)
		case "/emby/Users/user/Items/library":
			fmt.Fprint(w, `{"Id":"library","Name":"TV","Type":"CollectionFolder","CollectionType":"tvshows","IsFolder":true}`)
		case "/emby/Users/user/Items":
			listed = true
			if strings.Contains(r.URL.Query().Get("Fields"), "MediaSources") {
				t.Error("directory requested playback sources")
			}
			if r.URL.Query().Get("Limit") != "10000" {
				t.Error("batch size was lost")
			}
			if r.URL.Query().Get("EnableImages") != "false" || r.URL.Query().Get("EnableUserData") != "false" {
				t.Error("directory requested unused artwork or watch-state metadata")
			}
			fmt.Fprint(w, `{"Items":[{"Id":"series","Name":"Series 2","Type":"Series","IsFolder":true}],"TotalRecordCount":1}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	service := NewEmbyService(nil)
	result, err := service.FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test-key", Path: "library", Limit: 10000})
	if err != nil {
		t.Fatal(err)
	}
	if !listed || len(result.GetItems()) != 1 || result.GetItems()[0].GetName() != "Series 2" {
		t.Fatal("directory listing changed")
	}
}

func TestFsListPreservesLibraryHierarchy(t *testing.T) {
	for _, tc := range []struct {
		name, itemType, collectionType, childType, includedType string
	}{
		{"jellyfin library without collection type", "CollectionFolder", "", "Series", ""},
		{"mixed library", "CollectionFolder", "mixed", "Folder", ""},
		{"TV library", "CollectionFolder", "tvshows", "Series", "Series"},
		{"movie library", "CollectionFolder", "movies", "Movie", "Movie"},
		{"physical folder", "Folder", "", "Series", ""},
		{"user root", "UserRootFolder", "", "CollectionFolder", ""},
		{"physical root", "AggregateFolder", "", "Folder", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/emby/Items/library/Ancestors":
					fmt.Fprint(w, `[]`)
				case "/emby/Users/user/Items/library":
					_ = json.NewEncoder(w).Encode(map[string]any{"Id": "library", "Name": "Library", "Type": tc.itemType, "CollectionType": tc.collectionType, "IsFolder": true})
				case "/emby/Users/user/Items":
					query := r.URL.Query()
					if query.Get("ParentId") != "library" || query.Get("StartIndex") != "10" || query.Get("Limit") != "10" {
						t.Error("directory scope or pagination was lost")
					}
					if query.Get("IncludeItemTypes") != tc.includedType {
						t.Errorf("item type filter = %q, want %q", query.Get("IncludeItemTypes"), tc.includedType)
					}
					// Reproduce Jellyfin's untyped CollectionFolder response: an
					// unfiltered recursive query returns episodes, not its series.
					if query.Get("Recursive") == "true" && query.Get("IncludeItemTypes") == "" {
						fmt.Fprint(w, `{"Items":[{"Id":"episode","Name":"Flattened episode","Type":"Episode"}],"TotalRecordCount":3355}`)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{map[string]any{"Id": "child", "Name": "Child", "Type": tc.childType, "IsFolder": tc.childType != "Movie"}}, "TotalRecordCount": 147})
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			result, err := NewEmbyService(nil).FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test", Path: "library", StartIndex: 10, Limit: 10})
			if err != nil {
				t.Fatal(err)
			}
			if result.GetTotal() != 147 || len(result.GetItems()) != 1 || result.GetItems()[0].GetType() != tc.childType {
				t.Fatalf("library hierarchy flattened: %v", result)
			}
		})
	}
}

func TestFsListSearchRemainsRecursiveAndScoped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/emby/Items/library/Ancestors":
			fmt.Fprint(w, `[]`)
		case "/emby/Users/user/Items/library":
			fmt.Fprint(w, `{"Id":"library","Name":"TV","Type":"CollectionFolder"}`)
		case "/emby/Users/user/Items":
			query := r.URL.Query()
			if query.Get("Recursive") != "true" || query.Get("ParentId") != "library" || query.Get("SearchTerm") != "Title" {
				t.Error("search must include descendants within the selected library")
			}
			fmt.Fprint(w, `{"Items":[{"Id":"episode","Name":"Title","Type":"Episode","IndexNumber":1,"ParentIndexNumber":1}],"TotalRecordCount":1}`)
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	result, err := NewEmbyService(nil).FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test", Path: "library", SearchTerm: "Title", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.GetItems()) != 1 || result.GetItems()[0].GetName() != "S01E01 · Title" {
		t.Fatal("recursive episode search changed")
	}
}

func TestEpisodeDisplayNames(t *testing.T) {
	for _, tc := range []struct{ input, expected string }{
		{`{"Name":"Title","Type":"Episode","IndexNumber":1,"ParentIndexNumber":1}`, "S01E01 · Title"},
		{`{"Name":"Special","Type":"Episode","IndexNumber":2,"ParentIndexNumber":0}`, "S00E02 · Special"},
		{`{"Name":"Double","Type":"Episode","IndexNumber":9,"IndexNumberEnd":10,"ParentIndexNumber":2}`, "S02E09-E10 · Double"},
		{`{"Name":"Title","Type":"Episode","IndexNumber":5}`, "E05 · Title"},
		{`{"Name":"Unknown","Type":"Episode"}`, "Unknown"},
		{`{"Name":"Movie","Type":"Movie","IndexNumber":1}`, "Movie"},
	} {
		var item client.Items
		if err := json.Unmarshal([]byte(tc.input), &item); err != nil {
			t.Fatal(err)
		}
		if got := item2pb(&item).GetName(); got != tc.expected {
			t.Fatalf("got %q, expected %q", got, tc.expected)
		}
	}
}

func TestFsListKeepsCompleteBreadcrumbs(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/emby/Users/user/Items/season":
			fmt.Fprint(w, `{"Id":"season","Name":"Season 1","Type":"Season","ParentId":"series","SeriesId":"series"}`)
		case "/emby/Items/season/Ancestors":
			if r.URL.Query().Get("UserId") != "user" {
				t.Error("ancestor lookup lost the user's virtual libraries")
			}
			// ParentId points to a physical folder, but Ancestors returns the
			// user's configured virtual library. No name-based deduplication.
			fmt.Fprint(w, `[{"Id":"series","Name":"Series","Type":"Series","ParentId":"physical-library"},{"Id":"library","Name":"TV","Type":"CollectionFolder"},{"Id":"root","Name":"Media Folders","Type":"UserRootFolder"}]`)
		case "/emby/Shows/series/Episodes":
			if r.URL.Query().Get("SeasonId") != "season" || r.URL.Query().Get("Limit") != "10" || r.URL.Query().Get("StartIndex") != "10" {
				t.Error("season scope or pagination was lost")
			}
			fmt.Fprint(w, `{"Items":[{"Id":"episode","Name":"Title","Type":"Episode","IndexNumber":11,"ParentIndexNumber":1}],"TotalRecordCount":12}`)
		default:
			t.Errorf("redundant metadata request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	result, err := NewEmbyService(nil).FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test", Path: "season", StartIndex: 10, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, p := range result.GetPaths() {
		names = append(names, p.GetName())
	}
	if strings.Join(names, "/") != "Home/TV/Series/Season 1" || result.GetPaths()[1].GetPath() != "library" {
		t.Fatalf("logical breadcrumbs lost: %v", result.GetPaths())
	}
	if requests != 3 {
		t.Fatalf("directory took %d requests, expected 3", requests)
	}
}

func TestFsListLegacyAncestorFallback(t *testing.T) {
	currentLookups := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/emby/Users/user/Items/series":
			currentLookups++
			fmt.Fprint(w, `{"Id":"series","Name":"TV","Type":"Series","ParentId":"library"}`)
		case "/emby/Users/user/Items/library":
			fmt.Fprint(w, `{"Id":"library","Name":"TV","Type":"CollectionFolder","ParentId":"root"}`)
		case "/emby/Users/user/Items/root":
			fmt.Fprint(w, `{"Id":"root","Name":"root","Type":"UserRootFolder","ParentId":"unused"}`)
		case "/emby/Items/series/Ancestors":
			w.WriteHeader(http.StatusNotFound)
		case "/emby/Shows/series/Seasons":
			if r.ContentLength > 0 || r.URL.Query().Get("UserId") != "user" || r.URL.Query().Get("EnableImages") != "false" || r.URL.Query().Get("Limit") != "10" {
				t.Error("season listing options must be query parameters")
			}
			fmt.Fprint(w, `{"Items":[{"Id":"season","Name":"Season 1","Type":"Season"}],"TotalRecordCount":1}`)
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	result, err := NewEmbyService(nil).FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test", Path: "series", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if currentLookups != 1 || len(result.GetPaths()) != 3 || result.GetPaths()[1].GetPath() != "library" || result.GetPaths()[2].GetPath() != "series" {
		t.Fatalf("legacy fallback lost legitimate same-name folders: %v", result)
	}
}

func TestFsListViewsUsesQueryOptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/emby/Users/user/Views" || r.ContentLength > 0 || r.URL.Query().Get("EnableImages") != "false" || r.URL.Query().Get("Limit") != "10" {
			t.Error("library view options must be query parameters")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"Items":[],"TotalRecordCount":0}`)
	}))
	defer server.Close()
	if _, err := NewEmbyService(nil).FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test", Limit: 10}); err != nil {
		t.Fatal(err)
	}
}

func TestPlaybackItemLookupKeepsMediaSources(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Query().Get("Fields"), "MediaSources") {
			t.Error("playback sources were removed")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"Items":[{"Id":"episode","Name":"Episode","Type":"Episode","MediaSources":[{"Id":"source","Container":"mkv"}]}],"TotalRecordCount":1}`)
	}))
	defer server.Close()
	result, err := NewEmbyService(nil).GetItems(context.Background(), &pb.GetItemsReq{Host: server.URL, UserId: "user", Token: "test-key", ParentId: "season"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.GetItems()) != 1 || len(result.GetItems()[0].GetMediaSourceInfo()) != 1 {
		t.Fatal("playback media metadata missing")
	}
}
