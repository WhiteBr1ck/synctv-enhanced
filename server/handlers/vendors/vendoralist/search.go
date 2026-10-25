package vendoralist

import (
	"context"
	"errors"
	"path"
	"strings"

	"github.com/synctv-org/vendors/api/alist"
)

type alistSearchClient interface {
	FsSearch(context.Context, *alist.FsSearchReq) (*alist.FsSearchResp, error)
	FsList(context.Context, *alist.FsListReq) (*alist.FsListResp, error)
}

// Keep indexed descendant search when available. Without an upstream index,
// search one complete directory, not just the visible page or the whole drive.
func searchWithFallback(ctx context.Context, cli alistSearchClient, req *alist.FsSearchReq) (*alist.FsSearchResp, bool, error) {
	result, err := cli.FsSearch(ctx, req)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "search not available") {
		return result, false, err
	}
	const limit = 10000
	matches := []*alist.FsSearchResp_FsSearchContent{}
	keyword := strings.ToLower(strings.TrimSpace(req.GetKeywords()))
	var received uint64
	for page := uint64(1); ; page++ {
		listing, err := cli.FsList(ctx, &alist.FsListReq{Host: req.GetHost(), Token: req.GetToken(), Password: req.GetPassword(), Path: req.GetParent(), Page: page, PerPage: 1000})
		if err != nil {
			return nil, true, err
		}
		received += uint64(len(listing.GetContent()))
		if listing.GetTotal() > limit || received > limit {
			return nil, true, errors.New("当前目录超过 10000 项，请进入子目录搜索，或开启 AList 索引搜索")
		}
		for _, item := range listing.GetContent() {
			if strings.Contains(strings.ToLower(item.GetName()), keyword) {
				matches = append(matches, &alist.FsSearchResp_FsSearchContent{Parent: req.GetParent(), Name: item.GetName(), IsDir: item.GetIsDir(), Size: item.GetSize(), Type: item.GetType()})
			}
		}
		if received >= listing.GetTotal() {
			break
		}
		if len(listing.GetContent()) == 0 {
			return nil, true, errors.New("目录读取不完整，请重试搜索")
		}
	}
	result = &alist.FsSearchResp{Total: uint64(len(matches)), Content: matches}
	if size := req.GetPerPage(); size != 0 {
		page := max(uint64(1), req.GetPage())
		if page-1 > result.Total/size {
			result.Content = []*alist.FsSearchResp_FsSearchContent{}
		} else {
			start := (page - 1) * size
			result.Content = matches[start:min(start+size, result.Total)]
		}
	}
	return result, true, nil
}

func searchResultSubPath(root, parent, name string) (string, error) {
	root = path.Clean("/" + strings.Trim(root, "/"))
	parent = path.Clean("/" + strings.Trim(parent, "/"))
	if parent != root && root != "/" && !strings.HasPrefix(parent, root+"/") {
		return "", errors.New("search result is outside the configured folder")
	}
	return path.Join("/", strings.TrimPrefix(parent, root), name), nil
}
