-- Fictional bookkeeping sample for an isolated demo. No real companies, people or accounts.
INSERT INTO company (id,name,vat_number,chamber_number,country,address_line1,postal_code,city,email,default_currency,default_due_days) VALUES
(1,'Northlight Studio B.V.','NL000000000B00','00000000','NL','Voorbeeldstraat 1','1000 AA','Amsterdam','billing@northlight.example.test','EUR',30);

-- The RGS starter chart, as "Load starter" would insert it.
INSERT INTO accounts (rgs_code,reknr,parent_code,nivo,omskort,omslang,dc,bw,sortimentcode,is_leaf) VALUES
('B',NULL,NULL,1,'Balans','Balansrekeningen',NULL,'B',NULL,0),
('BIva',NULL,'B',2,'Imm. vaste activa','Immateriële vaste activa','D','B',NULL,0),
('BMva',NULL,'B',2,'Mat. vaste activa','Materiële vaste activa','D','B',NULL,0),
('BFva',NULL,'B',2,'Fin. vaste activa','Financiële vaste activa','D','B',NULL,0),
('BVrd',NULL,'B',2,'Voorraden','Voorraden','D','B',NULL,0),
('BPro',NULL,'B',2,'Onderh. projecten','Onderhanden projecten in opdracht van derden','D','B',NULL,0),
('BVor',NULL,'B',2,'Vorderingen','Vorderingen','D','B',NULL,0),
('BEff',NULL,'B',2,'Effecten','Effecten','D','B',NULL,0),
('BLim',NULL,'B',2,'Liquide middelen','Liquide middelen','D','B',NULL,0),
('BEiv',NULL,'B',2,'Eigen vermogen','Eigen vermogen','C','B',NULL,0),
('BVrz',NULL,'B',2,'Voorzieningen','Voorzieningen','C','B',NULL,0),
('BLas',NULL,'B',2,'Langlop. schulden','Langlopende schulden','C','B',NULL,0),
('BKas',NULL,'B',2,'Kortlop. schulden','Kortlopende schulden','C','B',NULL,0),
('W',NULL,NULL,1,'Winst & verlies','Winst- en verliesrekening',NULL,'W',NULL,0),
('WOmz',NULL,'W',2,'Netto-omzet','Netto-omzet','C','W',NULL,0),
('WWiv',NULL,'W',2,'Wijz. voorraden','Wijziging in voorraden gereed product en onderhanden werk','C','W',NULL,0),
('WGec',NULL,'W',2,'Geac. productie','Geactiveerde productie eigen bedrijf','C','W',NULL,0),
('WOvb',NULL,'W',2,'Ov. bedr.opbrengst','Overige bedrijfsopbrengsten','C','W',NULL,0),
('WKpr',NULL,'W',2,'Kostprijs omzet','Kostprijs van de omzet','D','W',NULL,0),
('WPer',NULL,'W',2,'Personeelskosten','Personeelskosten','D','W',NULL,0),
('WAfs',NULL,'W',2,'Afschrijvingen','Afschrijvingen op vaste activa','D','W',NULL,0),
('WBwv',NULL,'W',2,'Bijz. waardeverm.','Bijzondere waardeverminderingen','D','W',NULL,0),
('WOvk',NULL,'W',2,'Ov. bedr.kosten','Overige bedrijfskosten','D','W',NULL,0),
('WFbl',NULL,'W',2,'Fin. baten/lasten','Financiële baten en lasten','D','W',NULL,0),
('WBel',NULL,'W',2,'Belastingen','Belastingen over de winst','D','W',NULL,0);

INSERT INTO parties (id,kind,name,contact_name,email,vat_number,country,address_line1,postal_code,city,currency) VALUES
(1,'customer','Harbour Coffee Roasters','Sam Jansen','accounts@harbour-coffee.example.test',NULL,'NL','Kade 12','3511 AB','Utrecht','EUR'),
(2,'customer','Atelier Verde','Lina Peeters','finance@atelier-verde.example.test','BE0000000000','BE','Groenstraat 4','2000','Antwerpen','EUR'),
(3,'customer','Kestrel Logistics','Noor de Wit','ap@kestrel.example.test',NULL,'NL','Havenweg 88','3089 JH','Rotterdam','EUR'),
(4,'supplier','Pixel Print Works','Ties Bakker','invoices@pixelprint.example.test',NULL,'NL','Drukkerijlaan 3','5611 AA','Eindhoven','EUR');

INSERT INTO products (id,kind,sku,name,description,price_cents,vat_rate,unit,income_account) VALUES
(1,'service','WS-01','Brand workshop','One-day brand strategy workshop',95000,21,'day','WOmz'),
(2,'service','MT-01','Website maintenance','Monthly updates and monitoring',45000,21,'month','WOmz'),
(3,'service','PH-01','Photography session','Half-day product shoot',60000,21,'session','WOmz');

-- Totals follow recomputeTotals: Atelier Verde is an EU business with a VAT id, so its line is reverse charged.
INSERT INTO invoices (id,type,party_id,issue_date,due_date,subtotal_cents,vat_cents,total_cents,reverse_charge,reference,notes) VALUES
(1,'invoice',1,date('now','-40 days'),date('now','-10 days'),185000,38850,223850,0,'PO-4471','Thank you for your business.'),
(2,'invoice',2,date('now','-12 days'),date('now','+18 days'),60000,0,60000,1,NULL,'Reverse charge: VAT to be accounted for by the recipient.'),
(3,'invoice',3,NULL,NULL,45000,9450,54450,0,NULL,NULL);

INSERT INTO invoice_lines (invoice_id,position,product_id,description,quantity,unit,unit_price_cents,vat_rate,account_code,subtotal_cents,vat_cents,total_cents) VALUES
(1,1,1,'Brand workshop',1,'day',95000,21,'WOmz',95000,19950,114950),
(1,2,2,'Website maintenance',2,'month',45000,21,'WOmz',90000,18900,108900),
(2,1,3,'Photography session',1,'session',60000,21,'WOmz',60000,0,60000),
(3,1,2,'Website maintenance',1,'month',45000,21,'WOmz',45000,9450,54450);

-- Issuing through the ledger triggers numbers the invoices and posts their balanced journal entries.
UPDATE invoices SET status = 'issued', mutation_actor = 'Sample data', mutation_actor_kind = 'system' WHERE id IN (1, 2);
UPDATE invoices SET status = 'paid' WHERE id = 1;
UPDATE invoices SET status = 'sent' WHERE id = 2;
