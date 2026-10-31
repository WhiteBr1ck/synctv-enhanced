package vendoralist

import (
	"context"
	"errors"
	"path"

	"github.com/synctv-org/synctv/internal/cache"
	"github.com/synctv-org/synctv/internal/op"
	"github.com/synctv-org/synctv/utils"
	"github.com/synctv-org/vendors/api/alist"
)

type FolderSubtitle struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Language  string `json:"language,omitempty"`
	MatchRank int    `json:"matchRank,omitempty"`
	URL       string `json:"url"`
	Origin    string `json:"origin"`
}

func (s *AlistVendorService) subtitleFolder(ctx context.Context, subPath string) (*cache.AlistUserCacheData, string, error) {
	serverID, video, err := cache.AlistMoviePath(s.movie.Movie, subPath)
	if err != nil {
		return nil, "", err
	}
	creator, err := op.LoadOrInitUserByID(s.movie.CreatorID)
	if err != nil {
		return nil, "", err
	}
	auth, err := creator.Value().AlistCache().LoadOrStore(ctx, serverID)
	return auth, video, err
}

type subtitleListClient interface {
	FsList(context.Context, *alist.FsListReq) (*alist.FsListResp, error)
}

func listFolderSubtitles(ctx context.Context, cli subtitleListClient, req *alist.FsListReq, video string) ([]FolderSubtitle, error) {
	tracks := []FolderSubtitle{}
	var received uint64
	for page := uint64(1); ; page++ {
		req.Page, req.PerPage = page, 1000
		req.Refresh = req.Refresh && page == 1
		listing, err := cli.FsList(ctx, req)
		if err != nil {
			return nil, err
		}
		received += uint64(len(listing.GetContent()))
		if listing.GetTotal() > 10000 || received > 10000 {
			return nil, errors.New("当前文件夹超过 10000 项，无法完整读取字幕列表")
		}
		for _, item := range listing.GetContent() {
			if item.GetIsDir() || !utils.ValidSubtitleFile(item.GetName()) {
				continue
			}
			language, rank := utils.MatchSubtitleFile(video, item.GetName())
			tracks = append(tracks, FolderSubtitle{Name: item.GetName(), Type: utils.SubtitleFileType(item.GetName()), Language: language, MatchRank: rank, Origin: "external"})
		}
		if received >= listing.GetTotal() {
			return tracks, nil
		}
		if len(listing.GetContent()) == 0 {
			return nil, errors.New("字幕目录读取不完整，请重试")
		}
	}
}

func (s *AlistVendorService) FolderSubtitles(ctx context.Context, subPath string, refresh bool) ([]FolderSubtitle, error) {
	auth, video, err := s.subtitleFolder(ctx, subPath)
	if err != nil {
		return nil, err
	}
	return listFolderSubtitles(ctx, s.Client(), &alist.FsListReq{Host: auth.Host, Token: auth.Token, Password: s.movie.VendorInfo.Alist.Password, Path: path.Dir(video), Refresh: refresh}, path.Base(video))
}

func (s *AlistVendorService) ReadFolderSubtitle(ctx context.Context, subPath, name string) ([]byte, error) {
	if !utils.ValidSubtitleFile(name) {
		return nil, errors.New("无效的字幕文件名")
	}
	auth, video, err := s.subtitleFolder(ctx, subPath)
	if err != nil {
		return nil, err
	}
	file, err := s.Client().FsGet(ctx, &alist.FsGetReq{Host: auth.Host, Token: auth.Token, Password: s.movie.VendorInfo.Alist.Password, Path: path.Join(path.Dir(video), name), UserAgent: utils.UA})
	if err != nil {
		return nil, err
	}
	if file.GetIsDir() || file.GetRawUrl() == "" {
		return nil, errors.New("字幕文件不可读取")
	}
	return cache.FetchSubtitleContent(ctx, file.GetRawUrl())
}
