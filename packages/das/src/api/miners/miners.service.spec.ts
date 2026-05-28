import { DataSource } from "typeorm";
import { MinersService } from "./miners.service";

describe("MinersService pull-request time windows (#139)", () => {
  let queryMock: jest.Mock;
  let service: MinersService;

  beforeEach(() => {
    queryMock = jest.fn().mockResolvedValue([]);
    const dataSource = { query: queryMock } as unknown as DataSource;
    service = new MinersService(dataSource);
  });

  it("getPullRequests filters CLOSED PRs by closed_at", async () => {
    await service.getPullRequests("12345", "2026-01-01T00:00:00.000Z");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0] as [string, string[]];
    expect(sql).toContain("p.state = 'CLOSED' AND p.closed_at >= $2");
    expect(sql).not.toMatch(/p\.state = 'CLOSED' AND p\.created_at >= \$2/);
  });

  it("getPullRequestsByRepo filters CLOSED PRs by closed_at", async () => {
    await service.getPullRequestsByRepo(
      "12345",
      ["entrius/gittensor"],
      ["2026-01-01T00:00:00.000Z"],
    );

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0] as [string, string[]];
    expect(sql).toContain("p.state = 'CLOSED' AND p.closed_at >= w.since");
    expect(sql).not.toMatch(
      /p\.state = 'CLOSED' AND p\.created_at >= w\.since/,
    );
  });
});
