package alist

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	pb "github.com/synctv-org/vendors/api/alist"
	"google.golang.org/protobuf/proto"
)

func TestDirectoryDatesSurviveTransport(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"code":200,"data":{"content":[{"name":"Episode.mkv","created":"2025-01-02T03:04:05Z","modified":"2026-02-03T04:05:06Z"},{"name":"No dates"}],"total":2}}`)
	}))
	defer server.Close()
	response, err := NewAlistService(nil).FsList(context.Background(), &pb.FsListReq{Host: server.URL, Path: "/media", Page: 1, PerPage: 1000})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := proto.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	decoded := new(pb.FsListResp)
	if err := proto.Unmarshal(encoded, decoded); err != nil {
		t.Fatal(err)
	}
	created := uint64(time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC).UnixMilli())
	modified := uint64(time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC).UnixMilli())
	if decoded.GetContent()[0].GetCreated() != created || decoded.GetContent()[0].GetModified() != modified {
		t.Fatal("source dates were lost or conflated")
	}
	if decoded.GetContent()[1].GetCreated() != 0 || decoded.GetContent()[1].GetModified() != 0 {
		t.Fatal("missing dates became artificial future timestamps")
	}
}
