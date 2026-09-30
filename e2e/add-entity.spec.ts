import { expect, test } from "@playwright/test";

/** A forgotten bank account or owner is added after "Simpan klien", from the client's settings page; nothing has to be deleted and redone. */
test("add a bank account and an owner to an existing client", async ({ page }) => {
  await page.goto("/clients/new");
  await page.getByLabel("Nama klien").fill("Klien Tambah Rekening");
  await page.getByLabel("Nama lengkap").fill("PT Tambah Rekening");
  await page.getByLabel("Nomor rekening").fill("5550009999");
  await page.getByRole("button", { name: "Simpan klien" }).click();
  await expect(page.getByRole("heading", { name: "Impor Mutasi" })).toBeVisible();
  const base = new URL(page.url()).pathname.match(/\/clients\/[^/]+/)![0];

  // Impor says how it differs from Dokumen, and where a missing account is added.
  await expect(page.getByText("Yang diimpor di sini langsung menjadi jurnal.")).toBeVisible();
  await page.getByRole("link", { name: "Tambahkan di Aturan klasifikasi" }).click();
  const card = page.getByTestId("entities-card");
  await expect(card).toContainText("PT Tambah Rekening");
  await expect(card).toContainText("5550009999 · 1101");

  // A second account for the PT, then a wrong number says what to fix.
  await card.getByRole("button", { name: "Tambah rekening" }).click();
  const addBank = card.getByTestId(/^add-bank-/);
  await addBank.getByLabel("Nomor rekening").fill("12");
  await addBank.getByRole("button", { name: "Simpan rekening" }).click();
  await expect(addBank).toContainText("Nomor rekening berisi 6–20 angka.");
  await addBank.getByLabel("Nomor rekening").fill("5550008888");
  await addBank.getByLabel("Nama rekening").fill("Mandiri Tambahan");
  await addBank.getByRole("button", { name: "Simpan rekening" }).click();
  await expect(card).toContainText("Mandiri Tambahan");
  await expect(card).toContainText("5550008888 · 1102");

  // The owner, with no bank account yet.
  await card.getByRole("button", { name: "Tambah perusahaan atau pemilik" }).click();
  const addEntity = card.getByTestId("add-entity");
  await addEntity.getByRole("button", { name: "Simpan" }).click();
  await expect(addEntity).toContainText("Isi nama pemilik.");
  await addEntity.getByLabel("Nama lengkap").fill("Budi Tambah");
  await addEntity.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(card).toContainText("Budi Tambah");
  await expect(card).toContainText("Perorangan (pemilik)");

  // The new account is offered on the upload page.
  await page.goto(`${base}/import`);
  await page.getByRole("combobox", { name: "Rekening", exact: true }).click();
  await expect(page.getByRole("option", { name: /Mandiri Tambahan/ })).toBeVisible();
});

/** Names change, unused things can go, anything with books stays and says why (the reason is written next to the disabled button). */
test("rename and remove companies and bank accounts", async ({ page }) => {
  await page.goto("/clients/new");
  await page.getByLabel("Nama klien").fill("Klien Ubah Hapus");
  await page.getByLabel("Nama lengkap").fill("PT Ubah Hapus");
  await page.getByLabel("Nomor rekening").fill("5551110000");
  await page.getByLabel("Nama rekening").fill("BCA Giro");
  await page.getByRole("button", { name: "Simpan klien" }).click();
  await expect(page.getByRole("heading", { name: "Impor Mutasi" })).toBeVisible();
  const base = new URL(page.url()).pathname.match(/\/clients\/[^/]+/)![0];

  // Books: one statement imported into the BCA account.
  const file = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "05/08/2026;TRSF CR TOKO MAJU;0;5000000;105000000", ""].join("\n");
  await page.getByTestId("file-input").setInputFiles({ name: "rekening-agustus.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
  await page.getByRole("button", { name: "Proses mutasi" }).click();
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");

  // Two things entered by mistake: an empty second account and an empty owner.
  await page.goto(`${base}/settings`);
  const card = page.getByTestId("entities-card");
  await card.getByRole("button", { name: "Tambah rekening" }).click();
  const addBank = card.getByTestId(/^add-bank-/);
  await addBank.getByLabel("Nomor rekening").fill("5551119999");
  await addBank.getByLabel("Nama rekening").fill("Mandiri Kosong");
  await addBank.getByRole("button", { name: "Simpan rekening" }).click();
  await expect(card).toContainText("Mandiri Kosong");
  await card.getByRole("button", { name: "Tambah perusahaan atau pemilik" }).click();
  const addEntity = card.getByTestId("add-entity");
  await addEntity.getByLabel("Nama lengkap").fill("Pemilik Kosong");
  await addEntity.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(card).toContainText("Pemilik Kosong");

  // With books, the company and its BCA account can't be removed, and the reason is right there.
  const pt = card.getByTestId(/^entity-/).filter({ hasText: "PT Ubah Hapus" });
  await expect(pt.getByRole("button", { name: "Hapus" }).first()).toBeDisabled();
  await expect(pt.getByTestId("remove-blocked").first()).toContainText(/Sudah ada .*1 mutasi bank, 1 impor rekening koran/);
  await expect(pt.getByTestId("remove-blocked").first()).toContainText("koreksi lewat Jurnal Penyesuaian");
  const bca = card.getByTestId(/^bank-/).filter({ hasText: "BCA Giro" });
  await expect(bca.getByTestId("remove-blocked")).toContainText(/Sudah ada 1 impor rekening koran, 1 mutasi bank.*Rekening yang sudah dipakai tidak bisa dihapus\./);

  // Its number is locked (statements are matched against it), its name is not.
  await bca.getByRole("button", { name: "Ubah BCA Giro" }).click();
  const editBca = card.getByTestId(/^edit-bank-/);
  await expect(editBca.getByLabel("Nomor rekening")).toBeDisabled();
  await expect(editBca).toContainText("Bank dan nomor terkunci");
  await editBca.getByLabel("Nama rekening").fill("BCA Operasional");
  await editBca.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(card).toContainText("BCA Operasional");

  // Renaming the company changes the name only.
  await pt.getByRole("button", { name: "Ubah PT Ubah Hapus" }).click();
  const editPt = card.getByTestId(/^edit-entity-/);
  await editPt.getByLabel("Nama lengkap").fill("PT Ubah Hapus Makmur");
  await editPt.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(card).toContainText("PT Ubah Hapus Makmur");

  // The empty account and the empty owner can go, after a second click.
  const empty = card.getByTestId(/^bank-/).filter({ hasText: "Mandiri Kosong" });
  await empty.getByRole("button", { name: "Hapus" }).click();
  await empty.getByRole("button", { name: "Ya, hapus" }).click();
  await expect(card).not.toContainText("Mandiri Kosong");
  const owner = card.getByTestId(/^entity-/).filter({ hasText: "Pemilik Kosong" });
  await owner.getByRole("button", { name: "Hapus" }).click();
  await expect(owner).toContainText("Hapus Pemilik Kosong dan rekeningnya? Tidak bisa dibatalkan.");
  await owner.getByRole("button", { name: "Ya, hapus" }).click();
  await expect(card).not.toContainText("Pemilik Kosong");

  // The books are what they were: the statement is still there under the renamed company.
  await expect(card).toContainText("5551110000");
  await page.goto(`${base}/import`);
  await expect(page.getByRole("table").first()).toContainText("rekening-agustus.csv");
});
