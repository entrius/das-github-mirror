import { NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import { AdminController } from "./admin.controller";
import { Repo } from "../entities";
import { FETCH_JOBS } from "../queue/constants";

describe("AdminController", () => {
  let controller: AdminController;
  let fetchQueue: jest.Mocked<Pick<Queue, "add">>;
  let repoRepo: jest.Mocked<Pick<Repository<Repo>, "update" | "createQueryBuilder">>;
  let queryBuilder: {
    where: jest.Mock;
    getOne: jest.Mock;
  };

  const storedRepo: Repo = {
    repoFullName: "entrius/das-github-mirror",
    installationId: "1",
    webhookSecret: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    lastEventAt: null,
    defaultBranch: "test",
    registered: false,
  };

  beforeEach(() => {
    fetchQueue = { add: jest.fn().mockResolvedValue(undefined) };
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(storedRepo),
    };
    repoRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    controller = new AdminController(
      fetchQueue as unknown as Queue,
      repoRepo as unknown as Repository<Repo>,
    );
  });

  it("registerRepo enqueues backfill with canonical repo_full_name", async () => {
    const result = await controller.registerRepo({
      repoFullName: "Entrius/das-github-mirror",
    });

    expect(queryBuilder.where).toHaveBeenCalledWith(
      "LOWER(repo.repo_full_name) = LOWER(:repoFullName)",
      { repoFullName: "Entrius/das-github-mirror" },
    );
    expect(repoRepo.update).toHaveBeenCalledWith("entrius/das-github-mirror", {
      registered: true,
    });
    expect(fetchQueue.add).toHaveBeenCalledWith(
      FETCH_JOBS.BACKFILL_REPO,
      { repoFullName: "entrius/das-github-mirror" },
      expect.objectContaining({
        jobId: expect.stringMatching(/^backfill-entrius\/das-github-mirror-/),
      }),
    );
    expect(result.repoFullName).toBe("entrius/das-github-mirror");
  });

  it("triggerBackfill enqueues with canonical repo_full_name", async () => {
    const result = await controller.triggerBackfill({
      repoFullName: "Entrius/das-github-mirror",
      days: 7,
    });

    expect(fetchQueue.add).toHaveBeenCalledWith(
      FETCH_JOBS.BACKFILL_REPO,
      { repoFullName: "entrius/das-github-mirror", days: 7 },
      expect.any(Object),
    );
    expect(result.repoFullName).toBe("entrius/das-github-mirror");
  });

  it("triggerBackfill throws when repo is not installed", async () => {
    queryBuilder.getOne.mockResolvedValueOnce(null);

    await expect(
      controller.triggerBackfill({ repoFullName: "entrius/unknown" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchQueue.add).not.toHaveBeenCalled();
  });
});
